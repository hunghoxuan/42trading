# Spa / vật lý trị liệu — module cơ bản

Mở `/admin/spa` trong 42trade, hoặc chọn **Spa** trên menu desktop/mobile.
Module quản lý một chuỗi chung; nhân viên nghiệp vụ là hồ sơ, không bắt buộc có tài khoản đăng nhập riêng.
Không cần Google Sheets hay giấy phép AppSheet.

## Sử dụng

1. Tạo cơ sở, sau đó dịch vụ và bảng giá. Dịch vụ có thể dùng toàn chuỗi hoặc chỉ thuộc một cơ sở.
2. Tạo nhân viên, ngày bắt đầu/nghỉ việc, lương tháng và ngày hiệu lực. Khi đổi lương, nhập ngày hiệu lực mới; sửa cùng ngày là sửa chính mức lương tại ngày đó.
3. Tạo khách hàng; ghi nhận tư vấn, nhu cầu, lời khuyên và ngày chăm sóc lại.
4. Tạo liệu trình theo khách + dịch vụ, số buổi và hạn sử dụng nếu có.
5. Xếp lịch làm việc theo nhân viên/cơ sở. Sau ngày làm cập nhật **Đã làm**, giờ vào/ra thực tế hoặc dùng giờ dự kiến khi bỏ trống cả hai.
6. Tạo lịch hẹn, phân công nhân viên, chọn tại cơ sở/tại nhà. Với tại nhà, nhập địa chỉ, thời gian di chuyển mỗi chiều, phí thu khách và hỗ trợ trả nhân viên.
7. Cập nhật ca **Hoàn thành** sau khi thực hiện. Ca hoàn thành hoặc đã hủy không sửa lại trong bản cơ bản.
8. Chọn **Báo cáo & lương**, tuần hoặc tháng, ngày trong kỳ. Tuần bắt đầu thứ hai. Có thể xuất bảng lương tạm tính CSV UTF-8.

## Quy tắc vận hành

- Tất cả thời gian hiển thị và kỳ báo cáo dùng Asia/Ho_Chi_Minh (UTC+7), tiền nguyên VND.
- Ca cần nằm trong lịch làm việc tại cơ sở phụ trách; nhân viên có thể được xếp làm tại cơ sở khác cơ sở chính.
- Lịch tại nhà chặn thêm thời gian đi và về. Kiểm tra trùng cả nhân viên và khách. Các thao tác ghi chạy trong transaction, khóa đồng thời trước khi kiểm tra.
- Giá/hoa hồng cố định theo dịch vụ, tách tại cơ sở/tại nhà. Lưu giá/hoa hồng ngay khi đặt ca; đổi bảng giá không đổi các ca đã đặt. Đổi dịch vụ/địa điểm trên ca chưa hoàn thành sẽ lấy mức mới.
- Mỗi ca thuộc tối đa một liệu trình. Các ca chưa hủy giữ chỗ số buổi; chỉ ca hoàn thành tính là đã dùng. Hủy trả lại chỗ đặt. Không giảm tổng số buổi xuống dưới số đã làm/đặt.
- Hồ sơ có trạng thái hoạt động dùng ngừng hoạt động thay cho xóa. Cơ sở/nhân viên/khách/dịch vụ ngừng hoạt động không nhận ca mới; ca đã tồn tại vẫn có thể hoàn thành.
- Có kiểm tra phiên bản khi sửa, tránh ghi đè thay đổi từ màn hình khác. Tải lại dữ liệu sau khi gặp thông báo xung đột.

## Bảng lương cơ bản

Lương tạm tính = lương cứng phân bổ + hoa hồng ca hoàn thành + hỗ trợ đi lại.

Lương cứng phân bổ theo **ngày lịch**: mức lương tháng hiệu lực tại mỗi ngày chia số ngày của chính tháng đó. Chỉ tính những ngày thuộc thời gian làm việc của nhân viên. Ví dụ lương 6.200.000đ trong tháng 31 ngày là 200.000đ/ngày. Tuần giao hai tháng dùng mẫu số riêng cho từng tháng. Giờ công hiển thị độc lập, chưa dùng để khấu trừ lương; nhân viên ngừng hoạt động vẫn có dữ liệu lịch sử, cần nhập ngày nghỉ việc để kết thúc phần lương phân bổ.

Hoa hồng/hỗ trợ chỉ tính ca hoàn thành theo ngày hẹn ở Việt Nam. Phí thu khách không mặc định chuyển toàn bộ cho nhân viên. Mức lương có lịch sử theo ngày hiệu lực; bảng lương là xem trước động, chưa khóa sổ hoặc xác nhận chi trả. Kỳ đang diễn ra bao gồm cả lương cứng dự kiến tới cuối kỳ đã chọn.

Báo cáo giá trị dịch vụ là tổng giá lưu của ca hoàn thành; chưa phải báo cáo thực thu/công nợ. Chưa gồm thuế, bảo hiểm, khấu trừ, tạm ứng, thanh toán gói, hoàn tiền hoặc bảng lương đã chốt. Chưa có quản lý giường/phòng, tồn kho, gửi nhắc lịch hay cổng đặt lịch công khai.

## Tích hợp và lưu trữ

- UI: `src/admin/modules/spa/`; dùng API client, shared UI, auth và ACL sẵn có.
- API: `GET /api/spa/bootstrap`, `GET /api/spa/reports?from=YYYY-MM-DD&to=YYYY-MM-DD`, `POST /api/spa/:entity`, `PUT /api/spa/:entity/:id`.
- Entity công khai: `branches`, `employees`, `services`, `customers`, `consultations`, `treatment_plans`, `work_logs`, `appointments`. Khi sửa phải gửi `updated_at` đã đọc. `salary_rates` chỉ ghi nội bộ cùng transaction cập nhật nhân viên.
- Quyền: `pages.spa`, `apis.spa.read`, `apis.spa.write`. Admin hiện có quyền wildcard; role mới `spa_manager` có quyền toàn module. Không tự cấp quyền cho buyer/seller/trader.
- SQLite local: `data/modules/spa/data.db`; tùy chọn `SPA_SQLITE_PATH`. Postgres: dùng pool/backend đã chọn trong 42trade. Không tự chuyển backend theo sự hiện diện URL.
- Schema tự khởi tạo idempotent: `spa_branches`, `spa_employees`, `spa_salary_rates`, `spa_services`, `spa_customers`, `spa_consultations`, `spa_treatment_plans`, `spa_work_logs`, `spa_appointments`; khóa nội bộ `id`, mã ổn định `sid`, timestamps và người cập nhật.
- Không có seed dữ liệu vận hành. Bản đầu tải snapshot danh mục/lịch vào trình duyệt, có tìm kiếm/lọc/phân trang tại UI. Chưa xác nhận tải 1.000 người dùng đồng thời; khi tăng lịch sử cần phân trang/lọc phía server và đo tải.

## Kiểm tra

```bash
node --test src/api/modules/spa/service.test.js
node --test src/admin/modules/spa/config.test.mjs
node --test src/api/tests/unit/permissions.test.js src/admin/tests/unit/permissions.test.mjs
pnpm --dir src/admin exec vite build
```

Các test nghiệp vụ dùng SQLite in-memory và HTTP handler thật: kiểm tra lịch trùng, đồng thời, di chuyển, giới hạn liệu trình, hủy/trả buổi, snapshot giá/hoa hồng, lịch sử lương, mốc ngày Việt Nam, giờ công qua nửa đêm, validation và chặn quyền trước khi mở storage. Nhánh Postgres có adapter tương ứng nhưng cần kiểm thử tích hợp trên Postgres trước triển khai dùng backend đó.

Kiểm tra trình duyệt local: đăng nhập, mở Spa từ menu, tạo cơ sở/dịch vụ/nhân viên/khách và nhật ký làm việc; hoàn thành một ca cơ sở + một ca tại nhà; đối chiếu bảng lương tháng và tuần giao tháng; tải CSV; kiểm tra viewport 390px không tràn ngang trang. Bản ghi kiểm thử đã được xóa theo ID/SID cụ thể sau khi kiểm tra.
