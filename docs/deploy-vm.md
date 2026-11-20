# Chạy Kepler Hub trên máy ảo Ubuntu (Hyper-V) với HTTPS nội bộ

Dùng khi công ty có máy chủ Windows (ví dụ Domain Controller) nhưng không có máy chủ riêng cho ứng dụng. **Không chạy ứng dụng web trên DC**:
tạo một máy ảo Ubuntu có **IP LAN riêng**, coi như một máy độc lập. DC chỉ làm AD, DNS và kho file; không nhận, không chuyển tiếp cổng web.

```
Máy trạm ──https://hub.keplerholdings.vn──► Máy ảo Ubuntu 192.168.130.250 (switch External, IP LAN riêng)
                                              Caddy (TLS nội bộ) → app → Postgres → sao lưu
                                              └─ ghi tệp vào \\192.168.130.2\DATA (CIFS, tài khoản dịch vụ)
Máy chủ Windows (KEPLER-DC01, 192.168.130.2): AD, DNS, kho DATA, Hyper-V — không mở 80 / 443
```

Bố trí đang chạy từ 20/11/2026: máy ảo `KeplerHub`, IP **192.168.130.250**, tên duy nhất **`hub.keplerholdings.vn`**.

## Tên miền

- Dùng **một tên**: `hub.keplerholdings.vn`, thuộc tên miền công ty (đăng ký VNNIC). `APP_ORIGIN=https://hub.keplerholdings.vn`, `HUB_HOST="hub.keplerholdings.vn"`.
- **Không** dùng tên dưới domain AD `kepler.com` cho Hub: `kepler.com` chỉ là tên nội bộ của AD, tên công khai thuộc một đơn vị khác.
  Máy không dùng DNS của AD (VPN dùng 8.8.8.8, điện thoại) sẽ tra tên đó trên Internet — chủ thật của `kepler.com` tạo bản ghi là nhận được đăng nhập.
- Tên miền và chuyện "chỉ dùng nội bộ" là hai việc riêng: Hub chỉ vào được từ LAN / VPN vì IP là IP nội bộ, dù bản ghi công khai tồn tại.

## Cài mới

1. **Hyper-V** (cần khởi động lại máy chủ một lần): `Install-WindowsFeature Hyper-V -IncludeManagementTools`.
2. **Switch External** cho máy ảo ra LAN:
   - Máy chủ có card thứ hai cắm cùng switch LAN (khuyến nghị — DC không bị đụng):
     `New-VMSwitch -Name KeplerLAN -NetAdapterName "<card thứ hai>" -AllowManagementOS $false`
   - Chỉ có một card: `New-VMSwitch -Name KeplerLAN -NetAdapterName "<card đang dùng>" -AllowManagementOS $true`.
     IP của DC chuyển sang `vEthernet (KeplerLAN)`, mất mạng vài giây: làm ngoài giờ, lưu cấu hình IP trước, kiểm tra lại IP / gateway / DNS / `\\<DC>\DATA` ngay sau đó.
   - Tuỳ chọn, chỉ để quản trị máy ảo từ DC: switch Internal `KeplerNAT` (`New-VMSwitch KeplerNAT -SwitchType Internal`, `10.77.0.1/24` trên `vEthernet (KeplerNAT)`).
     Tắt đăng ký DNS cho card này: `Set-DnsClient -InterfaceAlias "vEthernet (KeplerNAT)" -RegisterThisConnectionsAddress $false` — nếu không, DNS của AD trả `kepler.com` về cả 10.77.0.1.
3. **Máy ảo**: Gen 2, 4 vCPU, 8 GB RAM, đĩa 200 GB, Secure Boot "Microsoft UEFI CA", Ubuntu Server 24.04 cài tự động
   (đĩa `CIDATA` chứa `user-data`: SSH chỉ khoá, docker, ufw 22/80/443). Màn hình cài hỏi "Continue with autoinstall?" → `yes`.
   Card mạng nối `KeplerLAN` (thêm `KeplerNAT` nếu dùng).
4. **IP tĩnh trong máy ảo** (`/etc/netplan/50-cloud-init.yaml`, quyền 600). Nhận card **theo địa chỉ MAC**, không theo driver: mọi card Hyper-V cùng driver
   `hv_netvsc`, nhận theo driver thì hai card giành nhau tên. Chặn cloud-init ghi đè: `echo 'network: {config: disabled}' | sudo tee /etc/cloud/cloud.cfg.d/99-disable-network-config.cfg`.

   ```yaml
   network:
     version: 2
     ethernets:
       eth1:                       # KeplerLAN
         match: { macaddress: "<MAC card KeplerLAN>" }
         set-name: eth1
         dhcp4: false
         addresses: ["192.168.130.250/24"]
         routes: [{ to: default, via: 192.168.130.1 }]
         nameservers: { addresses: [192.168.130.2] }
       eth0:                       # KeplerNAT, chỉ quản trị — không có default route
         match: { macaddress: "<MAC card KeplerNAT>" }
         set-name: eth0
         dhcp4: false
         addresses: ["10.77.0.10/24"]
   ```

   Áp bằng `sudo netplan generate && sudo netplan try --timeout 120` (tự quay lại nếu mất kết nối). IP chọn **ngoài dải DHCP** và đặt loại trừ trên thiết bị cấp DHCP.
5. **Cài ứng dụng** trong máy ảo (mã nguồn chép vào bằng `scp`): `sh deploy/vm-deploy.sh hub.keplerholdings.vn /đường/dẫn/org.json`.
   Lần đầu tạo thư mục dữ liệu, `.env` ngẫu nhiên (`MODULES=vanthu`), bật app + Caddy (`--profile https`), nhập tổ chức.
6. **DNS**
   - DNS của AD: zone riêng cho đúng tên Hub (không phải cả `keplerholdings.vn`, để các tên khác của công ty vẫn tra ra ngoài), kèm bản ghi ngược:
     ```powershell
     Add-DnsServerPrimaryZone -Name "hub.keplerholdings.vn" -ReplicationScope Domain
     Add-DnsServerResourceRecordA -ZoneName "hub.keplerholdings.vn" -Name "@" -IPv4Address 192.168.130.250
     Add-DnsServerResourceRecordPtr -ZoneName "130.168.192.in-addr.arpa" -Name "250" -PtrDomainName "hub.keplerholdings.vn"
     ```
   - DNS công khai (nhà quản lý tên miền): A `hub` → `192.168.130.250`, TTL 300 — cho máy nối VPN mà dùng DNS ngoài.
     Muốn không có bản ghi công khai: cấu hình VPN cấp DNS 192.168.130.2 cho máy kết nối, rồi mới xoá.
7. **Tin chứng chỉ**: lấy `caddy/caddy/pki/authorities/local/root.crt` trong thư mục dữ liệu → trên DC `certutil -dspublish -f root.crt RootCA`
   (máy trong domain tự tin sau `gpupdate`). Máy ngoài domain: tải `http://hub.keplerholdings.vn/kepler-hub-ca.crt`, cài vào "Trusted Root Certification Authorities".
8. **Nhân viên**: mở `https://hub.keplerholdings.vn/install.html` → "Cài lên máy".

Nâng cấp: chép mã mới vào máy ảo, chạy lại `sh deploy/vm-deploy.sh hub.keplerholdings.vn` (sao lưu trước, giữ `.env` và dữ liệu).
Quản trị: `ssh kepler@192.168.130.250` (ufw chỉ mở 22 cho mạng nội bộ).

## Chuyển từ bố trí cũ (NAT qua DC) sang IP riêng — đã làm 20/11/2026

Bố trí cũ: máy ảo 10.77.0.10 sau NAT, DC chuyển cổng 80 / 443 / 2222 vào. Thứ tự đổi không làm gián đoạn:

1. `Checkpoint-VM -Name KeplerHub -SnapshotName "truoc-tach-ip-<ngày>"`.
2. Tạo `KeplerLAN` (mục 2 ở trên), `Add-VMNetworkAdapter -VMName KeplerHub -SwitchName KeplerLAN -Name LAN` (thêm khi máy ảo đang chạy).
3. Netplan như mục 4, **nhưng giữ đường cũ chạy song song** cho tới khi DNS đổi xong: eth0 thêm `routes: [{to: default, via: 10.77.0.1, table: 100}]`
   và `routing-policy: [{from: 10.77.0.10, table: 100}]`. Định tuyến theo nguồn **không đủ cho Docker**: trả lời từ container có nguồn 172.x, đi ra eth1.
   Cần đánh dấu kết nối vào qua eth0 (tạm thời, mất khi khởi động lại):
   ```bash
   sudo iptables -t mangle -A PREROUTING -i eth0 -m conntrack --ctstate NEW -j CONNMARK --set-mark 100
   sudo iptables -t mangle -A PREROUTING ! -i eth0 -m connmark --mark 100 -j MARK --set-mark 100
   sudo ip rule add fwmark 100 table 100 priority 32700
   ```
4. DNS của AD và DNS công khai → IP mới (mục 6). Kiểm tra: `curl -k --resolve hub.keplerholdings.vn:443:<IP> https://hub.keplerholdings.vn/api/health`
   (Caddy cần đúng tên trong SNI — gọi thẳng bằng IP sẽ lỗi bắt tay TLS, không có nghĩa là Hub hỏng).
5. Chờ hết TTL cũ của bản ghi công khai, rồi trên DC:
   ```powershell
   Get-NetNatStaticMapping -NatName KeplerNAT | Where-Object ExternalPort -in 80,443,2222 | Remove-NetNatStaticMapping -Confirm:$false
   Disable-NetFirewallRule -DisplayName "Kepler Hub (HTTP/HTTPS)"
   Set-DnsClient -InterfaceAlias "vEthernet (KeplerNAT)" -RegisterThisConnectionsAddress $false
   Get-DnsServerResourceRecord -ZoneName kepler.com -RRType A | Where-Object { $_.RecordData.IPv4Address -eq '10.77.0.1' } | Remove-DnsServerResourceRecord -ZoneName kepler.com -Force
   ```
6. Bỏ `table 100` / `routing-policy` khỏi eth0 trong netplan khi tiện; xoá checkpoint sau vài ngày chạy ổn (`Remove-VMSnapshot`).

## Hết cảnh báo "kết nối không riêng tư" (16/11/2026)

- Chứng chỉ do Caddy của máy ảo tự cấp (`tls internal`) cho đúng tên trong `HUB_HOST`; **không phụ thuộc IP** — đổi IP không phải cấp lại. Máy cần tin chứng chỉ gốc **một lần**:
  - Máy trong domain: trên DC chạy `certutil -dspublish -f <kepler-hub-ca.crt> RootCA` (Domain Admin), máy trạm nhận qua Group Policy (hoặc `gpupdate /force`).
  - Máy ngoài domain / điện thoại: mở `http://hub.keplerholdings.vn/cai-chung-chi` (trang hướng dẫn, tải `kepler-hub-ca.crt`).
- Tên khác ngoài `hub.keplerholdings.vn` (không khuyến nghị): `HUB_HOST="hub.keplerholdings.vn, <tên-khác>"` và thêm cùng các tên vào `APP_ORIGIN` (`https://...`).
- Tiện ích Claude (`/downloads/kepper-claude.mcpb`): máy chủ lấy chứng chỉ gốc từ Caddy (`http://caddy/kepler-hub-ca.crt`, biến `HUB_CA_URL`), đóng vào gói và đặt `NODE_EXTRA_CA_CERTS`
  (Node trong Claude Desktop không đọc kho chứng chỉ của Windows), điền sẵn đúng địa chỉ người dùng đang mở. Máy còn trỏ tên cũ `kepler-hub.kepler.com`:
  đổi ô "Địa chỉ Kepler Hub" thành `https://hub.keplerholdings.vn`.
