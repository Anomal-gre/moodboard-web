export const vi = {
  appName: '0Y03',
  projects: 'Dự án',
  createProject: 'Tạo dự án',
  newProjectDefaultName: 'Phòng khách căn hộ',
  renameProject: 'Đổi tên dự án',
  deleteProject: 'Xóa dự án',
  currentProject: 'Đang mở',
  saveSaved: 'Đã lưu trên máy',
  saveSaving: 'Đang lưu…',
  saveUnsaved: 'Có thay đổi chưa lưu',
  saveError: 'Chưa lưu được',
  retry: 'Thử lại',

  // Top bar & actions
  aiClassify: 'Phân loại AI',
  arrangeBoard: 'Sắp moodboard',
  present: 'Trình bày',
  settings: 'Tùy chỉnh',
  moreMenu: 'Thêm tác vụ',
  exportPng: 'Xuất PNG',
  backupExport: 'Sao lưu dự án (.json)',
  backupImport: 'Nhập bản sao',
  trash: 'Thùng rác',
  shortcuts: 'Phím tắt',

  // Search & Inbox
  searchPlaceholder: 'Tìm trong bảng…',
  searchEmpty: 'Không tìm thấy card phù hợp',
  inInboxTag: 'Trong khay',
  unsorted: 'Chưa sắp xếp',
  inboxDropHint: 'Thả ảnh, file hoặc URL vào đây để gom trước khi xếp',
  inboxEmpty: 'Khay đang trống. Thả tư liệu vào đây hoặc kéo card lên bảng.',
  moveToBoard: 'Đưa lên bảng',
  moveToInbox: 'Đưa vào khay',

  // Dock tools
  addImageOrFile: 'Ảnh / File',
  addNote: 'Ghi chú',
  addLink: 'Link',
  addColor: 'Màu',
  addGroup: 'Nhóm',
  undo: 'Hoàn tác',
  redo: 'Làm lại',
  fitBoard: 'Vừa bảng',
  zoomReset: 'Về 100%',
  zoomIn: 'Phóng to',
  zoomOut: 'Thu nhỏ',

  // Empty state
  emptyBoardGuide: 'Kéo ảnh, dán URL hoặc nhấn bên dưới để bắt đầu bảng cảm hứng của bạn.',
  emptyAddImage: 'Thêm ảnh',

  // Categories
  cat_reference: 'Công trình / Không gian',
  cat_furniture: 'Đồ nội thất',
  cat_palette: 'Màu sắc',
  cat_material: 'Vật liệu',
  cat_sketch: 'Phác thảo / Mặt bằng',
  cat_other: 'Chưa phân loại',

  // Inspector & Source
  properties: 'Thuộc tính',
  titleLabel: 'Tiêu đề',
  categoryLabel: 'Phân loại',
  captionLabel: 'Ghi chú / Mô tả',
  sourceSection: 'Nguồn tham khảo',
  pageUrlLabel: 'URL trang gốc',
  pageUrlPlaceholder: 'https://pinterest.com/pin/…',
  imageUrlLabel: 'URL ảnh trực tiếp',
  fileNameLabel: 'Tên tệp gốc',
  noWebSource: 'Chưa có nguồn web',
  openSource: 'Mở nguồn',
  openImageUrl: 'Mở URL ảnh',
  replaceImage: 'Thay ảnh',
  viewLarge: 'Xem ảnh lớn',
  extractPalette: 'Trích bảng màu từ ảnh',
  copyHex: 'Sao chép HEX',
  copiedHex: 'Đã chép mã màu',
  hexLabel: 'Mã màu HEX',
  invalidHex: 'Nhập mã hợp lệ dạng #RRGGBB',
  invalidUrl: 'Chỉ chấp nhận URL http:// hoặc https:// không chứa mật khẩu',
  noteBgLabel: 'Màu nền ghi chú',
  fileFormatLabel: 'Định dạng',
  fileSizeLabel: 'Dung lượng',
  desktopHintFile: 'Đường dẫn máy và mở ứng dụng CAD/PSD thuộc bản desktop.',
  lockCard: 'Khóa vị trí',
  unlockCard: 'Mở khóa',
  duplicate: 'Nhân bản',
  deleteToTrash: 'Chuyển vào thùng rác',

  // Multi-select
  selectedCount: (n: number) => `Đã chọn ${n} mục`,
  groupCards: 'Tạo khung nhóm',
  ungroupCards: 'Tách nhóm',
  bringForward: 'Lên trên',
  sendBackward: 'Xuống dưới',
  alignLeft: 'Cân trái',
  alignTop: 'Cân trên',
  distributeH: 'Giãn ngang',

  // Appearance / Settings
  appearanceTitle: 'Tùy chỉnh bảng',
  bgPresetLight: 'Giấy sáng',
  bgPresetDark: 'Xưởng tối',
  bgCustomHex: 'Màu nền HEX',
  dotGrid: 'Hiện lưới chấm',
  languageLabel: 'Ngôn ngữ giao diện',
  storageNote: 'Dữ liệu và ảnh lưu cục bộ trên trình duyệt này (IndexedDB).',

  // Add Link modal
  addLinkTitle: 'Thêm liên kết tham khảo',
  linkUrlLabel: 'Đường dẫn (URL)',
  linkTitleLabel: 'Tên hiển thị (tùy chọn)',
  linkAsImageOption: 'Thử tải dưới dạng card ảnh (nếu URL cho phép)',
  addAction: 'Thêm vào bảng',
  cancel: 'Hủy',
  close: 'Đóng',
  apply: 'Áp dụng',

  // Arrange modal
  arrangeTitle: 'Sắp moodboard tự động',
  arrangeFreeform: 'Tự do (Collage)',
  arrangeGrid: 'Lưới đều',
  arrangeGroupByCat: 'Gom theo phân loại',
  arrangeOverlap: 'Độ xếp chồng',
  arrangeScopeSelection: (n: number) => `Đang áp dụng cho ${n} mục được chọn (bỏ qua mục khóa).`,
  arrangeScopeAll: 'Đang áp dụng cho toàn bộ card tự do trên bảng (bỏ qua khay và mục khóa).',
  preview: 'Xem trước',
  previewingHint: 'Đang xem trước bố cục trên bảng — bấm Áp dụng để chốt hoặc Hủy để hoàn nguyên.',

  // AI Classify modal
  aiTitle: 'Phân loại ảnh bằng AI cục bộ',
  aiSubtitle: 'Mô hình CLIP chạy trực tiếp trên trình duyệt qua Web Worker — không gửi ảnh lên máy chủ.',
  aiReadyHint: (count: number, skipped: number) =>
    skipped > 0
      ? `Sẵn sàng phân tích ${count} ảnh (bỏ qua ${skipped} ảnh lỗi/không có dữ liệu local).`
      : `Sẵn sàng phân tích ${count} ảnh trên bảng.`,
  aiNoImages: 'Không có ảnh hợp lệ nào để phân loại. Hãy thêm ảnh lên bảng trước.',
  aiStart: 'Bắt đầu phân loại',
  aiStop: 'Dừng lại',
  aiDownloading: 'Đang tải mô hình AI (lần đầu ~90–150MB, sau đó dùng cache)…',
  aiProcessing: (done: number, total: number) => `Đang phân tích ảnh ${done}/${total}…`,
  aiReviewNote: 'Kiểm tra và chỉnh sửa nhãn nếu AI đoán chưa chuẩn trước khi áp dụng.',
  aiRelativeScore: 'Mức khớp tương đối',
  aiApplySelected: (n: number) => `Áp dụng ${n} nhãn`,
  aiColdWarmInfo: (ms: number, cached: boolean) =>
    cached
      ? `Hoàn tất trong ${(ms / 1000).toFixed(1)}s (dùng model đã cache).`
      : `Hoàn tất trong ${(ms / 1000).toFixed(1)}s (bao gồm nạp model lần đầu).`,

  // Export modal
  exportTitle: 'Xuất ảnh Moodboard (PNG)',
  exportScopeAll: 'Toàn bộ bảng',
  exportScopeSelection: 'Phần đang chọn',
  exportScale: 'Độ phân giải',
  exportKeepBg: 'Giữ màu nền của dự án',
  exportIncludeSources: 'Tải kèm tệp danh sách nguồn (-sources.json)',
  exportEmptyReason: 'Phạm vi xuất hiện đang trống.',
  exportMissingTitle: 'Một số ảnh chưa có dữ liệu cục bộ',
  exportBackToFix: 'Quay lại sửa ảnh',
  exportWithPlaceholder: 'Xuất với ô giữ chỗ',
  exportTooLarge: 'Kích thước ảnh xuất vượt ngưỡng an toàn trình duyệt (tối đa 12.000 px mỗi cạnh hoặc 36 triệu pixel). Hãy giảm hệ số xuống 1× hoặc chọn ít card hơn.',
  exportSuccess: 'Đã xuất ảnh PNG thành công.',

  // Backup modal
  backupTitle: 'Sao lưu & Khôi phục dự án',
  backupExportDesc: 'Đóng gói dự án hiện tại cùng toàn bộ ảnh cục bộ thành tệp .moodboard.json để chuyển máy hoặc lưu dự phòng.',
  backupExportBtn: 'Tải tệp sao lưu (.moodboard.json)',
  backupImportDesc: 'Nhập tệp .moodboard.json thành một dự án mới độc lập (không ghi đè dự án đang có). Giới hạn 100 MB.',
  backupChooseFile: 'Chọn tệp bản sao…',
  backupConfirmImport: 'Nhập thành dự án mới',

  // Trash modal
  trashTitle: 'Thùng rác dự án',
  trashEmpty: 'Thùng rác đang trống.',
  restore: 'Khôi phục',
  emptyTrash: 'Dọn sạch thùng rác',

  // Present mode
  presentExitHint: 'Chế độ Trình bày · Kéo để di chuyển · Cuộn để thu phóng · Nhấn Esc để quay lại',
  exitPresent: 'Thoát trình bày',

  // Status & notifications
  readingImages: 'Đang đọc và tạo ảnh xem trước…',
  storageErrorTitle: 'Không thể đọc kho dữ liệu trình duyệt',
  storageErrorDesc: 'Kho IndexedDB gặp lỗi hoặc thuộc phiên bản mới hơn mức hỗ trợ. Dữ liệu cũ chưa bị ghi đè.',
  imageMissingBadge: 'Thiếu ảnh',
  imageRemoteBadge: 'Chưa lưu local',
};

export type I18nDict = typeof vi;
