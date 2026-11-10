from pathlib import Path
import sys
import json
sys.path.insert(0, str(Path('tmp/manual-python').resolve()))
import pypdfium2 as pdfium
from pypdf import PdfReader

pdf_file = Path('output/pdf/Supermarket_User_Manual_Tamil_v2.9.4.pdf')
render_dir = Path('output/manual/rendered')
render_dir.mkdir(parents=True, exist_ok=True)
document = pdfium.PdfDocument(str(pdf_file))
assert len(document) == 16, f'Expected 16 pages, got {len(document)}'
for index in range(len(document)):
    page = document[index]
    image = page.render(scale=1.55).to_pil()
    image.save(render_dir / f'page-{index+1:02d}.png')
    page.close()
reader = PdfReader(str(pdf_file))
text = '\n'.join(page.extract_text() or '' for page in reader.pages)
for phrase in ['Supplier Bills', 'Purchase Price', 'Selling Price', 'FIFO', 'Owner Investments']:
    assert phrase in text, f'Missing expected topic: {phrase}'
assert any('\u0b80' <= char <= '\u0bff' for char in text), 'Tamil text did not survive PDF export'
report = {'pages': len(reader.pages), 'bytes': pdf_file.stat().st_size, 'tamil_text_searchable': True, 'rendered_pages': len(list(render_dir.glob('page-*.png')))}
Path('output/manual/pdf-validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report))
