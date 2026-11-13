# Chạy Kepler Hub trên máy ảo Ubuntu (Hyper-V) với HTTPS nội bộ

Dùng khi công ty có máy chủ Windows (ví dụ Domain Controller) nhưng không có NAS. Không chạy ứng dụng web trực tiếp trên DC:
tạo một máy ảo Ubuntu, chỉ chuyển cổng 80 / 443 của máy chủ vào máy ảo.

```
Máy trạm ──https://kepler-hub.<miền>──► Máy chủ Windows (DNS nội bộ, NAT Hyper-V 80/443) ──► Máy ảo Ubuntu 10.77.0.10
                                                                              Caddy (TLS nội bộ) → app → Postgres → sao lưu
```

1. **Hyper-V** (cần khởi động lại máy chủ một lần): `Install-WindowsFeature Hyper-V -IncludeManagementTools`.
2. **Mạng nội bộ + NAT** (không đụng card mạng thật của máy chủ):
   `New-VMSwitch KeplerNAT -SwitchType Internal`, `New-NetIPAddress 10.77.0.1/24` trên `vEthernet (KeplerNAT)`, `New-NetNat -InternalIPInterfaceAddressPrefix 10.77.0.0/24`.
3. **Máy ảo**: Gen 2, 4 vCPU, 8 GB RAM, đĩa 200 GB, Secure Boot "Microsoft UEFI CA", Ubuntu Server 24.04 cài tự động
   (đĩa `CIDATA` chứa `user-data`: IP tĩnh 10.77.0.10, SSH chỉ khoá, docker, ufw 22/80/443). Màn hình cài hỏi "Continue with autoinstall?" → `yes`.
4. **Chuyển cổng**: `Add-NetNatStaticMapping -NatName KeplerNAT -Protocol TCP -ExternalIPAddress 0.0.0.0 -ExternalPort 443 -InternalIPAddress 10.77.0.10 -InternalPort 443` (và 80);
   mở tường lửa Windows cho 80 / 443.
5. **Cài ứng dụng** trong máy ảo (mã nguồn chép vào bằng `scp`): `sh deploy/vm-deploy.sh kepler-hub.<miền> /đường/dẫn/org.json`.
   Lần đầu tạo `/srv/kepler-hub`, `.env` ngẫu nhiên (`MODULES=vanthu`), bật app + Caddy (`--profile https`), nhập tổ chức.
6. **DNS**: `Add-DnsServerResourceRecordA -ZoneName <miền> -Name kepler-hub -IPv4Address <IP máy chủ>`.
7. **Tin chứng chỉ**: lấy `/srv/kepler-hub/caddy/caddy/pki/authorities/local/root.crt` → trên DC `certutil -dspublish -f root.crt RootCA`
   (máy trong domain tự tin sau `gpupdate`). Máy ngoài domain: tải `http://kepler-hub.<miền>/kepler-hub-ca.crt`, cài vào "Trusted Root Certification Authorities".
8. **Nhân viên**: mở `https://kepler-hub.<miền>/install.html` → "Cài lên máy".

Nâng cấp: chép mã mới vào máy ảo, chạy lại `sh deploy/vm-deploy.sh kepler-hub.<miền>` (sao lưu trước, giữ `.env` và dữ liệu).
