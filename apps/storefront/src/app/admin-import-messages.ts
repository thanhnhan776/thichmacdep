const messages: Record<string, string> = {
  'Formula cells are not supported': 'Không hỗ trợ ô chứa công thức.',
  'Unsupported cell type or cell exceeds length limit': 'Kiểu dữ liệu của ô không được hỗ trợ hoặc nội dung quá dài.',
  'XLSX parsing requires a browser': 'Cần sử dụng trình duyệt để đọc tệp XLSX.',
  'Workbook exceeds file size limit or is empty': 'Tệp rỗng hoặc vượt quá giới hạn dung lượng.',
  'Expected an unencrypted XLSX archive': 'Hãy chọn tệp XLSX không được mã hóa.',
  'Unreadable or encrypted workbook': 'Không thể đọc tệp hoặc tệp đã được mã hóa.',
  'Unsupported workbook structure': 'Cấu trúc tệp không được hỗ trợ.',
  'Workbook must contain exactly one sheet': 'Tệp phải chứa đúng một trang tính.',
  'Unsupported or empty worksheet': 'Trang tính rỗng hoặc không được hỗ trợ.',
  'Worksheet exceeds limits or has no header row': 'Trang tính vượt quá giới hạn hoặc không có dòng tiêu đề.',
  'Missing column header': 'Thiếu tiêu đề cột.',
  'Duplicate or unsupported column header': 'Tiêu đề cột bị trùng hoặc không được hỗ trợ.',
  'Missing required column': 'Thiếu cột bắt buộc.',
  'Workbook exceeds row or cell limit': 'Bảng tính vượt quá giới hạn số dòng hoặc số ô.',
  'Cell exceeds length limit': 'Nội dung ô vượt quá giới hạn độ dài.',
  'Service excluded': 'Dòng dịch vụ không được nhập.',
  'Missing or unrecognized classification': 'Thiếu loại hàng hoặc loại hàng không được nhận diện.',
  'SKU must be nonempty text': 'SKU phải là văn bản không để trống.',
  'Name must be nonempty text': 'Tên hàng phải là văn bản không để trống.',
  'Category must be nonempty text': 'Nhóm hàng phải là văn bản không để trống.',
  'Expected a nonnegative safe integer VND amount': 'Giá VND phải là số nguyên không âm trong phạm vi cho phép.',
  'Unrecognized status': 'Trạng thái không được nhận diện.',
  'Unrecognized direct-sale flag': 'Giá trị bán trực tiếp không được nhận diện.',
  'Expected ordered HTTPS URLs on trusted hosts': 'Cần các URL HTTPS theo thứ tự thuộc máy chủ được tin cậy.',
  'Expected one SIZE dimension': 'Cần đúng một thuộc tính SIZE.',
  'SIZE requires a matching complete hyphen-separated SKU suffix': 'SIZE phải khớp với phần cuối SKU sau dấu gạch nối.',
  'Duplicate SIZE in group': 'SIZE bị trùng trong nhóm.',
  'SKU conflicts with an existing catalog product or variant; manual resolution required': 'SKU xung đột với sản phẩm hoặc biến thể hiện có; cần xử lý thủ công.',
  'Invalid value': 'Giá trị không hợp lệ.',
};

/** Unknown errors can contain internal details, so only known messages are shown. */
export function translateImportReason(reason: string, fallback = 'Không thể kiểm tra dữ liệu này. Vui lòng kiểm tra và thử lại.'): string {
  if (Object.prototype.hasOwnProperty.call(messages, reason)) return messages[reason];
  const match = /^(Duplicate SKU|Standalone\/group key collision|Conflicting group fields) \(also row (\d+)\)$/.exec(reason);
  if (match) {
    const labels: Record<string, string> = {
      'Duplicate SKU': 'SKU bị trùng',
      'Standalone/group key collision': 'Mã sản phẩm đơn lẻ trùng với mã nhóm',
      'Conflicting group fields': 'Thông tin trong nhóm không nhất quán',
    };
    return `${labels[match[1]]} (cùng với dòng ${match[2]}).`;
  }
  return fallback;
}

const columns = new Set(['Mã hàng', 'Tên hàng', 'Nhóm hàng(3 Cấp)', 'Giá bán', 'Đang kinh doanh', 'Được bán trực tiếp', 'Hình ảnh (url1,url2...)', 'Thuộc tính', 'Loại hàng']);
export function translateImportColumn(column: string): string {
  return columns.has(column) ? column : 'Dữ liệu';
}
