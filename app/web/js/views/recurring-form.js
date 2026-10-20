// Ô chọn lịch lặp lại dùng chung: form tạo việc, panel việc ("Lặp lại việc này"), cài đặt dự án.
import { api } from '../api.js';
import { esc, openModal, closeModal, toast, errorMessage } from '../util.js';

const WEEKDAYS = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
// Giá trị "kiểu lặp" gộp tần suất + chỉ ngày làm việc cho dễ chọn.
const KINDS = [['WORKDAYS', 'Mỗi ngày làm việc (T2–T6)'], ['DAILY', 'Hằng ngày'], ['WEEKLY', 'Hằng tuần'], ['MONTHLY', 'Hằng tháng']];

export function scheduleFields(rule = {}, { allowNone = false, prefix = 'rec' } = {}) {
  const kind = rule.frequency ? (rule.frequency === 'DAILY' && rule.workdaysOnly ? 'WORKDAYS' : rule.frequency) : (allowNone ? '' : 'WEEKLY');
  const today = ((new Date().getDay() + 6) % 7) + 1;
  return `<div class="schedule" data-schedule>
    <label class="field">Lặp lại<select name="repeat" data-testid="${prefix}-repeat">${allowNone ? '<option value="">Không lặp lại</option>' : ''}${KINDS.map(([k, v]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
    <div class="grid2" data-repeat-detail>
      <label class="field" data-show="WEEKLY">Vào<select name="weekday" data-testid="${prefix}-weekday">${WEEKDAYS.map((d, i) => `<option value="${i + 1}"${(rule.weekday || today) === i + 1 ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
      <label class="field" data-show="MONTHLY">Ngày trong tháng<select name="monthDay">${Array.from({ length: 28 }, (_, i) => `<option value="${i + 1}"${rule.monthDay === i + 1 ? ' selected' : ''}>Ngày ${i + 1}</option>`).join('')}<option value="0"${rule.monthDay === 0 ? ' selected' : ''}>Ngày cuối tháng</option></select></label>
      <label class="field">Hạn sau khi tạo (ngày)<input type="number" name="dueOffsetDays" min="0" max="60" value="${rule.dueOffsetDays ?? 1}" data-testid="${prefix}-due"></label>
    </div>
    <p class="muted xs" data-repeat-hint>Việc mới được tạo tự động lúc 07:00 (giờ Việt Nam) theo lịch.</p>
  </div>`;
}
export function bindSchedule(root) {
  const box = root.querySelector('[data-schedule]'); if (!box) return;
  const sync = () => {
    const v = box.querySelector('[name=repeat]').value;
    box.querySelectorAll('[data-show]').forEach(el => el.classList.toggle('hidden', el.dataset.show !== v));
    box.querySelector('[data-repeat-detail]').classList.toggle('hidden', !v);
    box.querySelector('[data-repeat-hint]').classList.toggle('hidden', !v);
  };
  box.querySelector('[name=repeat]').addEventListener('change', sync); sync();
}
// Trả về null nếu "Không lặp lại".
export function readSchedule(root) {
  const box = root.querySelector('[data-schedule]'); if (!box) return null;
  const v = name => box.querySelector(`[name=${name}]`)?.value;
  const kind = v('repeat'); if (!kind) return null;
  return { frequency: kind === 'WORKDAYS' ? 'DAILY' : kind, workdaysOnly: kind === 'WORKDAYS', weekday: Number(v('weekday')), monthDay: Number(v('monthDay')), dueOffsetDays: Number(v('dueOffsetDays') || 0) };
}

// Hộp thoại "Lặp lại việc này" / "Sửa lịch lặp lại" từ panel việc.
export function openRepeatDialog({ item, rule, onDone }) {
  const modal = openModal(`<h2>${rule ? 'Sửa lịch lặp lại' : 'Lặp lại việc này'}</h2>
    <p class="muted sm">${rule ? 'Đổi lịch sẽ áp dụng từ lần tạo kế tiếp.' : `Hệ thống sẽ tự tạo bản sao của <b>${esc(item.code)} ${esc(item.title)}</b> (cùng mô tả, người nhận, nhãn, ưu tiên) theo lịch dưới đây.`}</p>
    <form>${scheduleFields(rule || {}, { prefix: 'repeat' })}<p class="error" id="repeatError"></p>
    <div class="modal-actions">${rule ? `<button type="button" class="btn btn-ghost" data-act="toggle">${rule.isActive ? 'Tạm dừng' : 'Bật lại'}</button><button type="button" class="btn btn-ghost" data-act="delete">Bỏ lặp lại</button>` : ''}
      <span class="grow"></span><button type="button" class="btn btn-ghost" data-act="cancel">Huỷ</button><button class="btn btn-primary" data-testid="repeat-save">${rule ? 'Lưu lịch' : 'Bật lặp lại'}</button></div></form>`);
  bindSchedule(modal);
  const finish = msg => { closeModal(); toast(msg, 'ok'); onDone?.(); };
  modal.onclick = async e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    try {
      if (act === 'cancel') closeModal();
      if (act === 'toggle') { await api(`/api/recurring/${rule.id}`, { method: 'PATCH', body: { isActive: !rule.isActive } }); finish(rule.isActive ? 'Đã tạm dừng lặp lại' : 'Đã bật lại lặp lại'); }
      if (act === 'delete') { await api(`/api/recurring/${rule.id}`, { method: 'DELETE' }); finish('Đã bỏ lặp lại'); }
    } catch (error) { modal.querySelector('#repeatError').textContent = errorMessage(error); }
  };
  modal.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const body = readSchedule(modal);
    try {
      if (rule) await api(`/api/recurring/${rule.id}`, { method: 'PATCH', body });
      else await api(`/api/items/${item.id}/recurring`, { method: 'POST', body });
      finish(rule ? 'Đã lưu lịch lặp lại' : 'Đã bật lặp lại cho việc này');
    } catch (error) { modal.querySelector('#repeatError').textContent = errorMessage(error); }
  };
}
