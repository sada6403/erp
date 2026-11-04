Furniture stock verification

Verified against the compiled Electron application, real IPC handlers, real SQLite schema and real React screens in an isolated QA workspace. Native file dialogs selected a controlled test workbook; email was disabled. Production company data was not used.

- Excel template contains Branch, Stock Date, Item Code, Description, Qty, Sale Price.
- Imported BED=1, CHAIR (JW)=19, CHAIR (RW)=15 into pending CHAVAKACHERY stock (35 units).
- The two chair descriptions sharing PDC 307 remain separate products.
- The existing Main Branch receives BED=2.
- Create Branch prefills CHAVAKACHERY and creates its manager through the real branch wizard.
- Branch creation applies the three pending quantities and clears the pending list.
- Reapplying returns appliedCount=0 and leaves stock unchanged.
- Retail and supermarket companies reject this furniture stock sheet and pending-stock access.
- The final Products screen shows branch quantities 1, 19 and 15 at 1280x800 (branch-stock-verified.png).
- Electron TypeScript compile, renderer typecheck, production web build and all three pending stock integration tests pass, including rollback if a stock movement fails.

The app test revealed Stock Date matching the generic Stock alias before Qty. The importer now checks all exact column aliases first, and the complete app flow passed after that correction.

Temporary QA databases were removed after verification. The installer was not rebuilt or deployed.
