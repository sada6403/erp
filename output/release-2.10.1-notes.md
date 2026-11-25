Windows POS keyboard checkout patch, now available through the in-app update feed.

- Reliable amount focus; contained Tab/Shift+Tab navigation and visible scrolling fields.
- Ctrl+1 Cash, Ctrl+2 Card, Ctrl+3 Bank, Ctrl+4 Installment (when enabled); F9/F10 Cash/Card.
- Agent suggestions support Arrow Up/Down and Enter. Enter selects the agent and moves to amount entry without submitting payment.
- Native Enter on Cancel/payment-method buttons, Enter on the amount to confirm, Ctrl+Enter to confirm from elsewhere, and Escape to close suggestions/payment.
- F2 customer selection suspends the underlying payment shortcuts. Repeated Enter is guarded against duplicate submissions.
- Cloud batch identity schema compatibility repaired; standalone portal build and Node 20 legacy-text decoding corrected.

Validation: TypeScript and Windows installer build passed; 318 unit tests and 337 local integration tests passed (23 integration tests skipped). Both public update feeds and installer/blockmap URLs were verified. An isolated Electron updater emitted update-available from 2.10.0 to 2.10.1 without installing anything.

[Download the Windows installer](https://updates.nfplantation.com/Enterprise%20POS%20ERP%20Setup%202.10.1.exe)

[Successful release workflow](https://github.com/sada6403/erp/actions/runs/45549635601)

Built commit: 7d1ae7161dc9a25d12bf0203666a0b77df9cb151.
