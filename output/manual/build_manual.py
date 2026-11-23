from pathlib import Path
import base64
import html

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'output' / 'pdf'
WORK = ROOT / 'output' / 'manual'
OUT.mkdir(parents=True, exist_ok=True)

def image(name, fallback, caption, css=''):
    file = WORK / 'screens' / name
    if not file.exists():
        file = ROOT / 'output' / 'playwright' / fallback
    data = base64.b64encode(file.read_bytes()).decode('ascii')
    return f'<figure class="{css}"><img src="data:image/png;base64,{data}"><figcaption>{caption}</figcaption></figure>'

def note(title, text, kind='note'):
    return f'<aside class="{kind}"><strong>{title}</strong><p>{text}</p></aside>'

def table(headings, rows, css=''):
    return '<table class="'+css+'"><thead><tr>'+''.join('<th>'+x+'</th>' for x in headings)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+str(c)+'</td>' for c in row)+'</tr>' for row in rows)+'</tbody></table>'

def steps(items):
    return '<ol class="steps">'+''.join('<li>'+x+'</li>' for x in items)+'</ol>'

def flow(items):
    return '<div class="flow">'+''.join('<span>'+x+'</span>' for x in items)+'</div>'

def section(title, lead, body):
    return f'<h1>{title}</h1><p class="lead">{lead}</p>{body}'

pages = []
contents = [
    ('02','தொடங்குவதற்கு முன் மற்றும் menus'), ('03','வந்த stock நேரடியாகப் பதிவு செய்தல்'),
    ('04','Direct stock form பட வழிகாட்டி'), ('05','Supplier Purchase Order உருவாக்குதல்'),
    ('06','Stock receive மற்றும் partial receiving'), ('07','Supplier bill upload மற்றும் details'),
    ('08','Bill history மற்றும் filters'), ('09','Product மற்றும் selling prices'),
    ('10','FIFO stock மற்றும் profit உதாரணம்'), ('11','POS billing செய்வது'),
    ('12','Stock and Profit totals புரிந்துகொள்வது'), ('13','Owner investments பதிவு செய்தல்'),
    ('14','Customer returns மற்றும் cancellation'), ('15','தினசரி checklist மற்றும் backup'),
    ('16','பொதுவான சிக்கல்களுக்கு தீர்வு'),
]
toc = '<div class="toc">'+''.join(f'<a href="#page-{int(n)}"><b>{n}</b><span>{t}</span></a>' for n,t in contents)+'</div>'
pages.append('''<div class="eyebrow">ENTERPRISE POS ERP</div>
<h1 class="cover-title">சூப்பர்மார்க்கெட்<br>பயனர் கையேடு</h1>
<p class="subtitle">Supermarket User Manual</p>
<p class="version">Version 2.9.4 &nbsp; | &nbsp; 07 நவம்பர் 2026</p>
<p class="lead">Stock வாங்குவது முதல் bill upload, sales, profit மற்றும் owner investment வரை தினசரி வேலைகளைச் சரியாகச் செய்வதற்கான தமிழ் வழிகாட்டி.</p>
<p>Owner, Company Admin, stock entry staff மற்றும் cashier பயன்படுத்தலாம். App-ல் இருக்கும் English menu மற்றும் button பெயர்கள் அப்படியே கொடுக்கப்பட்டுள்ளன.</p>
<h2>வேகமாகத் தொடங்க</h2>'''+flow(['Supplier மற்றும் product சரிபார்க்கவும்','Purchase பதிவு மற்றும் bill upload','Stock receive','POS sales','Stock மற்றும் profit பார்க்கவும்'])+
'''<h2>இந்தக் கையேட்டில்</h2>'''+toc+
note('முதலில் நினைவில் வைத்துக்கொள்ளுங்கள்','Purchase Price என்பது supplier-க்கு கொடுக்கும் விலை. Selling Price என்பது customer-க்கு விற்கும் விலை. Bill upload இல்லாமல் புதிய purchase-ஐ save செய்ய முடியாது.'))

pages.append(section('02 தொடங்குவதற்கு முன்',
    'சரியான company, branch மற்றும் account-ல் login செய்துள்ளீர்களா என்று முதலில் பார்க்கவும்.',
    table(['Menu','எதற்குப் பயன்படுத்துவது'],[
        ['Dashboard','ஏற்கனவே இருக்கும் sales summary, alerts, charts மற்றும் branch operations.'],
        ['Products → List Products','Product பெயர், SKU, cost, selling price மற்றும் stock பார்க்கவும்; அனுமதி இருந்தால் edit செய்யவும்.'],
        ['Stock Purchases & Bills','Purchase Order அல்லது Direct Stock பதிவு; supplier bills மற்றும் history.'],
        ['Products → Purchase Batches & Stock','ஒவ்வொரு batch-ன் purchased, sold, remaining quantity மற்றும் selling price.'],
        ['Stock & Profit','Stock valuation, expected sales/profit, earned profit மற்றும் investment total.'],
        ['Owner Investments','Owner கூடுதலாக முதலீடு செய்த தொகை மற்றும் தேதி.'],
        ['POS Billing','Customer sales bill மற்றும் payment.'],
        ['Sell → Returns & Refunds','Original invoice அடிப்படையில் customer return.'],
    ])+
    '<h2>Access மற்றும் module</h2>'+
    '<p>Purchase மற்றும் supplier procurement தற்போதைய system-ல் Main Branch access உள்ளவர்களுக்கு கிடைக்கும். Owner Investments-க்கு Company Admin access தேவை. மற்ற screens உங்கள் role மற்றும் plan permissions அடிப்படையில் தெரியும்.</p>'+
    '<p>Menu தெரியாவிட்டால் Company Admin: <b>Settings → General → Industry & Supermarket Settings → Supermarket Stock & Profit</b> setting-ஐச் சரிபார்த்து save செய்ய வேண்டும். Supermarket company-க்கு module ஏற்கனவே enabled ஆக இருக்கலாம்.</p>'+
    note('வேலை தொடங்கும் முன்','Supplier, product, quantity unit, purchase price, selling price, purchase date மற்றும் தெளிவான supplier bill ஆகியவற்றைத் தயாராக வைத்துக்கொள்ளுங்கள்.')))

pages.append(section('03 வந்த stock நேரடியாகப் பதிவு செய்தல்',
    'Supplier-இடம் ஏற்கனவே வாங்கி வந்த பொருட்களை bill பார்த்து உடனடியாக stock-ல் சேர்க்க இந்த வழியைப் பயன்படுத்தவும்.',
    image('purchase-options.png','tk-purchase-two-options.png','Stock Purchases & Bills பக்கத்தில் இரண்டாவது option-ஐத் தேர்வு செய்யவும்.','wide')+
    steps([
        '<b>Stock Purchases & Bills → 2. Add Received Stock Directly</b> click செய்யவும்.',
        '<b>Supplier</b> தேர்வு செய்யவும். பெயர் இல்லாவிட்டால் Add supplier மூலம் சேர்க்கலாம்.',
        '<b>Stock Received Date</b>-ல் உண்மையில் stock வந்த தேதியை உள்ளிடவும்.',
        '<b>Supplier Bill / Invoice Number</b> இருந்தால் bill-ல் இருப்பதை அப்படியே உள்ளிடவும்.',
        '<b>Upload supplier bill</b> click செய்து PDF அல்லது image தேர்வு செய்யவும்.',
        '<b>Select product</b>-ல் பெயர் அல்லது SKU search செய்து ஒவ்வொரு பொருளையும் சேர்க்கவும். Add Item மூலம் அடுத்த வரி சேர்க்கலாம்.',
        '<b>Qty, Purchase Price, Selling Price</b> சரிபார்க்கவும். Pack/box மற்றும் individual units குழப்பம் வராதபடி product unit-ஐ உறுதிசெய்யவும்.',
        'Total சரியாக இருந்தால் <b>Save & Receive Stock</b> click செய்யவும். Success message வந்ததைக் காத்திருக்கவும்.',
    ])+
    note('Save செய்தவுடன் என்ன நடக்கும்','Purchase RECEIVED ஆகப் பதிவாகும். Stock quantity மற்றும் புதிய FIFO batch சேரும். Current product cost மற்றும் உள்ளிடப்பட்ட selling price update ஆகும். Supplier bill purchase-உடன் இணைக்கப்படும்.')))

pages.append(section('04 Direct stock form பட வழிகாட்டி',
    'இந்த form-ல் supplier, stock date, bill மற்றும் ஒவ்வொரு product-ன் விலையையும் பதிவு செய்ய வேண்டும்.',
    image('direct-entry.png','mandatory-supplier-bill-direct.png','புதிய purchase-க்கு supplier bill கட்டாயம். Bill தேர்வு செய்யும்வரை Save & Receive Stock disabled ஆக இருக்கும்.','form-shot')+
    note('Final check','Quantity மற்றும் விலைகளை bill-உடன் ஒப்பிட்டு விட்டு save செய்யவும். Product-க்கு common selling price இல்லாவிட்டால் Selling Price-ஐ கட்டாயம் உள்ளிட வேண்டும்.')))

pages.append(section('05 Supplier Purchase Order உருவாக்குதல்',
    'Stock வரும்வரை order progress-ஐப் பதிவு செய்து, பிறகு receive செய்ய இந்த வழியைப் பயன்படுத்தவும்.',
    flow(['Create Purchase Order','DRAFT','SENT','PARTIAL அல்லது RECEIVED'])+
    steps([
        '<b>Stock Purchases & Bills → 1. Order from Supplier</b> தேர்வு செய்யவும்.',
        'Supplier, <b>Expected Delivery Date</b>, purchase date மற்றும் invoice number இருந்தால் உள்ளிடவும்.',
        'Products-ஐ பெயர்/SKU மூலம் search செய்து quantity, Purchase Price மற்றும் optional Selling Price உள்ளிடவும்.',
        '<b>Upload supplier bill</b> மூலம் குறைந்தது ஒரு PDF/image இணைக்கவும். v2.9.4-ல் புதிய order save செய்யவும் bill தேவை.',
        'Order total-ஐச் சரிபார்த்து <b>Create Purchase Order</b> click செய்யவும். இது DRAFT ஆகச் சேமிக்கப்படும்; stock இன்னும் அதிகரிக்காது.',
        'History-ல் <b>View</b> திறந்து <b>Send to Supplier</b> மூலம் அடுத்த workflow நிலைக்குச் செல்லவும்.',
    ])+
    table(['Status','பொருள்'],[
        ['DRAFT','Order பதிவு செய்யப்பட்டுள்ளது; stock receive செய்யப்படவில்லை.'],
        ['SENT','Order அடுத்த process நிலையில் உள்ளது; delivery-ஐக் காத்திருக்கிறது.'],
        ['PARTIAL','Order-ல் சில quantity மட்டும் வந்துள்ளது.'],
        ['RECEIVED','Order முழுவதும் receive செய்யப்பட்டுள்ளது.'],
        ['CANCELLED','Order cancel செய்யப்பட்டுள்ளது. ஏற்கனவே received stock-ஐ இதனால் திரும்பக் கழிக்க முடியாது.'],
    ])+
    note('Supplier-க்கு message அனுப்புவது','WhatsApp / Email actions மற்றும் notification options தனியாக உள்ளன. SENT status மட்டும் பார்த்து message சென்றுவிட்டது என்று கருத வேண்டாம்; அனுப்பிய communication result-ஐச் சரிபார்க்கவும்.')))

pages.append(section('06 Stock receive மற்றும் partial receiving',
    'Order-ல் இருந்த மொத்த quantity-ஐ விட, இப்போது உண்மையில் வந்த quantity மட்டும் பதிவு செய்யுங்கள்.',
    steps([
        '<b>Purchase Orders</b> tab-ல் order-ஐத் தேடி <b>View</b> திறக்கவும்.',
        'SENT அல்லது PARTIAL order-ல் <b>Receive Items</b> click செய்யவும்.',
        '<b>Purchase date</b>-ல் இந்த delivery வந்த தேதியைத் தேர்வு செய்யவும்.',
        '<b>Ordered</b> மற்றும் <b>Already Received</b> பார்த்து <b>Receiving Now</b>-ல் இப்போது வந்த அளவை உள்ளிடவும்.',
        'Batch selling price மாறியிருந்தால் உள்ளிடவும். Common பயன்படுத்தினால் product-க்கு செல்லுபடியான selling price இருக்க வேண்டும்.',
        'ஏற்கனவே இணைத்த bill இருந்தால் மீண்டும் upload தேவையில்லை. இந்த delivery-க்கு புதிய bill இருந்தால் upload செய்யவும். எந்த bill-மும் இல்லாமல் confirm செய்ய முடியாது.',
        '<b>Confirm Receipt</b> click செய்து success message வந்த பிறகு remaining stock/history சரிபார்க்கவும்.',
    ])+
    '<h2>Partial receiving உதாரணம்</h2>'+
    table(['நிலை','Ordered','ஏற்கனவே வந்தது','இப்போது உள்ளிடுவது'],[
        ['முதல் delivery','20','0','8'],
        ['இரண்டாவது delivery','20','8','12'],
    ])+
    note('மீண்டும் total quantity எழுத வேண்டாம்','இரண்டாவது delivery-ல் Receiving Now = 12. மீண்டும் 20 உள்ளிட வேண்டாம். ஒவ்வொரு receipt-க்கும் தனி batch/date பதிவு இருக்கும். முழுவதும் வந்தால் status RECEIVED ஆகும்.')+
    '<h2>Excel மூலம் order தயாரிப்பது</h2><p>Supermarket Excel import <b>draft orders</b> மட்டும் தயாரிக்கும். Import செய்த order-ஐ details-ல் திறந்து supplier bill upload செய்யவும்; பிறகு வழக்கம்போல் send/receive process தொடரவும். Excel file supplier bill-க்கு மாற்றாகாது.</p>'))

pages.append(section('07 Supplier bill upload மற்றும் details',
    'Bill-ன் தெளிவான படம் அல்லது PDF-ஐ purchase-உடன் சேமித்து வைத்துக்கொள்ளுங்கள்.',
    steps([
        'Entry form-ல் <b>Upload supplier bill</b> தேர்வு செய்யவும். ஏற்கனவே உள்ள purchase-க்கு <b>View → Attach PDF / Image</b> பயன்படுத்தவும்.',
        '<b>PDF, JPG, JPEG, PNG</b> files தேர்வு செய்யலாம். ஒவ்வொரு file-மும் 15 MB-க்கு மிகாமல் இருக்க வேண்டும்; empty file-ஐத் தேர்வு செய்ய வேண்டாம்.',
        'File பெயர் form-ல் வந்துள்ளதா என்று பார்க்கவும். பல பக்க bill என்றால் பல files தேர்வு செய்யலாம்.',
        'Purchase save ஆன பிறகு details-ல் file பெயருடன் upload செய்த நேரம், staff பெயர் மற்றும் file size தெரியும்.',
        'File பெயரை click செய்தால் கணினியின் PDF/image viewer-ல் bill திறக்கும்.',
    ])+
    image('bill-details.png','supplier-bill-upload-details.png','Purchase details-ல் attachment பெயருக்குக் கீழே uploaded time மற்றும் uploaded-by விவரங்கள் இருக்கும்.','detail-shot')+
    note('தவறான file upload செய்தால்','முதலில் சரியான bill-ஐ Attach PDF / Image மூலம் upload செய்யவும். அதன் பிறகு பழைய file-க்கு Correct / Remove தேர்வு செய்து காரணம் எழுதவும். கடைசி bill-ஐ replacement இல்லாமல் நீக்க முடியாது.')+
    note('Bill தெரியுமா என்று சரிபார்க்கவும்','Supplier பெயர், bill number, பொருட்கள், தேதி மற்றும் total படிக்கக்கூடியதாக இருக்க வேண்டும். தவறான supplier-ன் bill-ஐ இணைக்க வேண்டாம்.')))

pages.append(section('08 Bill history மற்றும் filters',
    'Upload செய்த bills பார்க்க வேண்டிய இடம் Stock Purchases & Bills பக்கத்தின் Supplier Bills tab.',
    '<p class="path">Stock Purchases & Bills → Supplier Bills → file பெயர் அல்லது Purchase Details</p>'+
    image('bill-history.png','supplier-bill-history-filters.png','Supplier Bills-ல் ஒவ்வொரு uploaded file-க்கும் தனி row இருக்கும்.','history-shot')+
    table(['Filter','எதைத் தேடுகிறது'],[
        ['Purchase date from / To','Stock purchase தேதி அடிப்படையில்.'],
        ['All suppliers','ஒரு supplier-ன் bills மட்டும்.'],
        ['Search','File name, supplier, invoice/purchase number அல்லது staff பெயர்.'],
        ['Uploaded from / Uploaded to','File system-ல் upload செய்யப்பட்ட local தேதி அடிப்படையில்.'],
        ['Uploaded by','அந்த staff upload செய்த bills மட்டும்.'],
        ['File type','PDF மட்டும் அல்லது images மட்டும்.'],
        ['Status','DRAFT, SENT, PARTIAL, RECEIVED போன்ற purchase நிலை.'],
    ])+
    note('இரண்டு தேதிகள் வேறு','Purchase Date என்பது வாங்கிய/பதிவு செய்த தேதி. Uploaded At என்பது file upload செய்த நேரம். File பெயரில் இருக்கும் தேதியையும் Uploaded At-ஐயும் ஒன்றாகக் கருத வேண்டாம். Filters அதிகமாக இருந்தால் match இல்லாமல் வரலாம்; தேவை இல்லாத filters-ஐ clear செய்யவும்.')))

pages.append(section('09 Product மற்றும் selling prices',
    'Purchase cost மற்றும் selling price இரண்டும் சரியாக இருந்தால்தான் stock valuation மற்றும் profit சரியாக இருக்கும்.',
    table(['Field','பொருள்','உதாரணம்'],[
        ['Purchase Price / Unit Cost','Supplier-க்கு ஒரு base unit-க்கு கொடுக்கும் விலை.','Rs.100'],
        ['Selling Price','Customer-க்கு ஒரு base unit விற்கும் விலை.','Rs.120'],
        ['Common','Product-ல் ஏற்கனவே இருக்கும் selling price-ஐ பயன்படுத்தும்.','Common price Rs.120 என்றால் அதே விலை.'],
        ['Batch Selling Price','அந்த purchase batch-க்கு தனியாக உள்ளிடும் selling price.','அடுத்த batch Rs.130 ஆக இருக்கலாம்.'],
    ])+
    '<h2>Receipt செய்தபின்</h2><p>Product cost மற்றும் உள்ளிடப்பட்ட selling price update ஆகும். பழைய batch purchase costs மாறாது; தனி batch selling prices தனியாகத் தொடரும்.</p>'+
    '<h2>Product-க்கு selling price சேர்ப்பது</h2>'+
    steps([
        '<b>Products → List Products</b> திறந்து பெயர் அல்லது SKU search செய்யவும்.',
        'அந்த row-ன் <b>Edit</b> pencil button-ஐத் தேர்வு செய்யவும்.',
        '<b>Cost Price</b> மற்றும் <b>Selling Price</b> சரிபார்த்து save செய்யவும்.',
        'Product/POS-ல் விலையைச் சரிபார்க்கவும். பழைய cart item இருந்தால் remove செய்து மீண்டும் சேர்க்கவும்.',
    ])+
    note('Common என்பதன் அர்த்தம்','Product selling price இல்லாவிட்டால் விற்கும் விலையை உள்ளிடுங்கள். Purchase cost-ஐ selling price என்று system ஊகிக்காது.')+
    '<p><b>Cost column 100 (5)</b> என்றால் 100 cost price; (5) stock-alert quantity. அது கூடுதல் விலை அல்லது discount அல்ல.</p>'+
    '<p>Batch price மாற்ற: <b>Purchase Batches & Stock → Selling</b>. Blank = Common. தனி விலை உள்ள பழைய batches-ஐயும் சரிபார்க்கவும்.</p>'))

pages.append(section('10 FIFO stock மற்றும் profit உதாரணம்',
    'FIFO என்பது முதலில் வந்த stock-ஐ முதலில் sales-க்கு ஒதுக்குவது. Billing செய்யும்போது system தானாக batch quantity கழிக்கும்.',
    table(['Purchase','Quantity','Unit cost','Purchase value'],[
        ['நாள் 1 Rice','5 kg','Rs.150','Rs.750'],
        ['நாள் 2 Rice','10 kg','Rs.200','Rs.2,000'],
        ['மொத்தம்','15 kg','','Rs.2,750'],
    ])+
    '<h2>7 kg ஐ Rs 250 விலையில் விற்றால்</h2>'+
    table(['FIFO deduction','Quantity','Cost'],[
        ['பழைய batch முழுவதும்','5 kg × Rs.150','Rs.750'],
        ['புதிய batch-ல் இருந்து','2 kg × Rs.200','Rs.400'],
        ['Sold stock purchase cost','','Rs.1,150'],
    ])+
    '<div class="numbers"><div><span>Sales</span><b>Rs.1,750</b></div><div><span>Purchase cost</span><b>Rs.1,150</b></div><div><span>Earned gross profit</span><b>Rs.600</b></div></div>'+
    '<h2>மீதமுள்ள stock</h2>'+
    table(['விவரம்','மதிப்பு'],[
        ['Remaining quantity','8 kg - புதிய batch-ல் மட்டும்'],
        ['Remaining purchase cost','8 × Rs.200 = Rs.1,600'],
        ['Expected sales value','8 × Rs.250 = Rs.2,000'],
        ['Expected remaining profit','Rs.2,000 - Rs.1,600 = Rs.400'],
    ])+
    note('இந்த உதாரணத்தில்','Discount, tax மற்றும் returns இல்லை. இது gross-profit விளக்கம்; business expenses கழித்த net profit அல்ல. பழைய stock 0 ஆனதும் batch screen-ல் Old stock finished என்று தெரியும்.')+
    '<p><b>Purchase Batches & Stock</b>-ல் Purchased, Sold, Remaining quantity-ஐப் பாருங்கள். பழைய batch quantity-ஐ manually edit செய்து sale-ஐ imitate செய்ய வேண்டாம்.</p>'))

pages.append(section('11 POS billing செய்வது',
    'Stock receipt சரியாக முடிந்த பிறகு வழக்கமான POS Billing வழியே customer sale பதிவு செய்யலாம்.',
    steps([
        'மேலே உள்ள <b>POS Billing</b> button-ஐத் தேர்வு செய்யவும்.',
        'Product பெயர்/SKU search செய்யவும் அல்லது அமைக்கப்பட்ட barcode scanner மூலம் scan செய்யவும்.',
        'Cart-ல் quantity, product unit, unit price மற்றும் total சரிபார்க்கவும். எடை பொருளுக்கு சரியான decimal quantity உள்ளிடவும்.',
        'Customer தேவையானால் தேர்வு செய்யவும். உங்கள் role அனுமதிக்கும் discount மட்டும் பயன்படுத்தவும்.',
        'Payment screen திறக்கவும். <b>F12</b> payment shortcut ஆக உள்ளது.',
        'Payment method மற்றும் received amount சரிபார்த்து <b>Confirm Payment</b> செய்யவும்.',
        '<b>Payment Complete</b> / invoice confirmation வந்ததை உறுதிசெய்து receipt print செய்யவும்.',
    ])+
    note('Sale முடிந்தவுடன்','Branch stock மற்றும் FIFO batches கழியும். Known batch purchase cost அடிப்படையில் actual gross profit பதிவு ஆகும். Stock போதவில்லை என்றால் sale தடுக்கப்படும்.')+
    '<h2>இரண்டு batch prices சேர்ந்தால்</h2>'+
    '<p>ஒரே sale line பழைய மற்றும் புதிய batches இரண்டையும் பயன்படுத்தினால், system சராசரி unit selling price காட்டலாம்.</p>'+
    table(['ஒதுக்கீடு','Sales value'],[
        ['5 units × Rs.250','Rs.1,250'],
        ['5 units × Rs.300','Rs.1,500'],
        ['10 units மொத்தம்','Rs.2,750 - unit average Rs.275'],
    ])+
    note('Price changed என்ற message','Product விலை மாற்றப்பட்ட பிறகு பழைய cart item இருந்தால் இந்த message வரலாம். Product-ஐ refresh / மீண்டும் cart-ல் சேர்த்து விலையை உறுதிசெய்து தொடரவும். ஒரே sale-ஐ success message பார்க்காமல் மீண்டும் confirm செய்ய வேண்டாம்.')))

pages.append(section('12 Stock and Profit totals',
    'Dashboard பழைய operational summary-க்காகத் தொடரும். Stock valuation மற்றும் batch profit-க்கு தனியாக Stock & Profit திறக்கவும்.',
    '<p class="path">Menu → Stock & Profit → ஐந்து totals → Refresh</p>'+
    table(['Card','எதைச் சொல்கிறது'],[
        ['Total Available Stock Value','மீதமுள்ள known-cost stock-ன் purchase value.'],
        ['Total Expected Sales Value','மீதமுள்ள stock தற்போதைய common/batch விலையில் விற்றால் கிடைக்கக்கூடிய value.'],
        ['Expected Profit from Remaining Stock','Known-cost மீதமுள்ள stock-க்கான expected sales minus purchase cost.'],
        ['Actual Profit Earned from Sales','Recorded batch sales-ன் discount-adjusted selling value minus original batch cost; returns/cancellations இதை மாற்றும்.'],
        ['Total Owner Investment','Owner Investments-ல் தனியாகப் பதிவு செய்த investment amounts-ன் total.'],
    ])+
    note('Historical cost unknown','பழைய stock/sales-க்கு original batch costs இல்லாவிட்டால் cost/profit totals-ல் அவை சேர்க்கப்படாது; affected quantity பற்றி message வரும். 0 காட்டுவது business-ல் profit இல்லை என்று அர்த்தமல்ல.')+
    '<p>இந்த profit cards business expenses கழித்த net-profit statement அல்ல. Owner investment என்பது sales அல்லது profit அல்ல. Page open/focus, periodic refresh மற்றும் <b>Refresh</b> button மூலம் totals புதுப்பிக்கப்படும்.</p>'))

pages.append(section('13 Owner investments பதிவு செய்தல்',
    'Owner கடைக்காகக் கூடுதலாக கொடுக்கும் பணத்தை sales-ல் சேர்க்காமல் தனி capital record ஆகச் சேமிக்கவும்.',
    steps([
        '<b>Company Admin</b> account-ல் login செய்து <b>Owner Investments</b> திறக்கவும்.',
        '<b>Amount</b>-ல் உண்மையில் முதலீடு செய்த தொகை உள்ளிடவும்.',
        '<b>Date</b>-ல் பணம் முதலீடு செய்த தேதியைத் தேர்வு செய்யவும்.',
        '<b>Record investment</b> click செய்து success message பார்க்கவும்.',
        'From / To dates மூலம் history filter செய்யவும். Stock & Profit-ல் Total Owner Investment-ஐச் சரிபார்க்கவும்.',
    ])+
    table(['Form field','பயன்பாடு'],[
        ['Amount','Owner முதலீடு செய்த தொகை.'],
        ['Date','முதலீடு செய்த தேதி.'],
        ['Record investment','Entry-ஐச் சேமிக்கும் button.'],
        ['From / To','Investment history-ன் தேதிகளை filter செய்யும்.'],
    ])+
    '<h2>History-ல் என்ன தெரியும்</h2><p>Date, Owner, Type மற்றும் Amount காட்டப்படும். புதிய record save செய்ததும் history-ல் வந்துள்ளதா சரிபார்க்கவும். Investment total தனியாக Stock & Profit card-ல் உள்ளது.</p>'+
    note('Double entry வேண்டாம்','Purchase entry செய்ததாலேயே Owner Investment தானாக உருவாகாது. Owner கொடுத்த பணத்தைத் தனியாக record செய்யுங்கள். அதே தொகையை மீண்டும் மீண்டும் investment ஆகப் பதிவு செய்ய வேண்டாம்.')+
    '<p>Purchase cost, sales collection, supplier payment மற்றும் owner investment ஆகியவை வெவ்வேறு records. Investment-ஐ sales bill அல்லது profit என்று பதிவு செய்ய வேண்டாம்.</p>'))

pages.append(section('14 Customer returns மற்றும் cancellation',
    'Customer திருப்பித் தரும் பொருளை original invoice-உடன் இணைத்து பதிவு செய்யவும்.',
    '<h2>Customer return</h2>'+
    steps([
        '<b>Sell → Returns & Refunds → New Return</b> திறக்கவும்.',
        '<b>Search Invoice</b>-ல் invoice number அல்லது customer-ஐத் தேடவும்.',
        'சரியான invoice தேர்வு செய்து product மற்றும் original sold quantity சரிபார்க்கவும்.',
        'உண்மையில் திரும்ப வந்த quantity மட்டும் உள்ளிடவும்; original returnable quantity-ஐ மீற முடியாது.',
        'Reason, refund method மற்றும் தேவையான notes உள்ளிடவும்.',
        'Refund total சரியாக உள்ளதா பார்த்து <b>Process Return</b> செய்யவும்.',
    ])+
    flow(['Original invoice','Return quantity','Original cost layer restore','Stock மற்றும் profit update'])+
    note('Batch tracking','Batch allocations உள்ள sales-க்கு return quantity original cost layers-க்கு திரும்பச் சேர்க்கப்படும். Historical allocation இல்லாத பழைய sales-ன் batch cost-ஐ system உருவாக்கி ஊகிக்காது.')+
    '<h2>Invoice அல்லது return cancel செய்ய வேண்டுமெனில்</h2>'+
    '<p>முதலில் owner / authorised manager-ஐ அணுகவும். Invoice-க்கு active returns இருந்தால் அவற்றைச் சரிபார்த்து cancel செய்யாமல் invoice cancel செய்ய முடியாது. Return cancel செய்தால் stock மீண்டும் கழியலாம்; அந்த returned stock ஏற்கனவே விற்கப்பட்டிருந்தால் operation தடுக்கப்படலாம்.</p>'+
    note('Supplier return வேறு வேலை','Supplier-க்கு அனுப்பும் purchase return-ஐ customer return screen-ல் பதிவு செய்ய வேண்டாம். Physical damaged/expired stock அல்லது supplier return இருந்தால் owner inventory process மூலம் சரிசெய்ய வேண்டும்.')+
    '<p>ஒரு தவறை சரிசெய்ய அதே purchase-ஐ duplicate-ஆகச் சேர்ப்பதும் stock quantity-ஐ நேரடியாக மாற்றுவதும் சரியான வழி அல்ல. Original document/reference-ஐ வைத்து authorised correction செய்யவும்.</p>'))

pages.append(section('15 தினசரி checklist மற்றும் backup',
    'Shift ஆரம்பம், ஒவ்வொரு delivery மற்றும் நாள் முடிவில் இந்த checks-ஐப் பின்பற்றவும்.',
    table(['எப்போது','சரிபார்க்க வேண்டியது'],[
        ['Shift ஆரம்பத்தில்','சரியான company மற்றும் branch; cashier account; stock/price தகவல்.'],
        ['Delivery வரும்போது','Supplier bill, product பெயர்/SKU, unit, actual quantity மற்றும் purchase date.'],
        ['Purchase save முன்','Bill upload; invoice number; purchase/selling prices; line total மற்றும் grand total.'],
        ['Purchase save பின்','Success message; purchase status; received/remaining stock; saved bill திறக்கிறதா.'],
        ['Sale முன்','Cart quantity, unit price, discount, payment method மற்றும் received amount.'],
        ['நாள் முடிவில்','Bills மற்றும் payment records; returns/cancellations; stock mismatch; unknown-cost warning.'],
        ['Owner review','Investment duplicate இல்லை; expected profit-ஐ actual earned profit என்று குழப்பவில்லை.'],
    ])+
    '<h2>Bill files மற்றும் backup</h2>'+
    '<p>Supplier bill files தற்போதைய computer-ன் company workspace-ல் சேமிக்கப்படுகின்றன. மற்றொரு computer-க்கு database sync ஆனதால் மட்டும் bill image/PDF அங்கே கிடைக்கும் என்று கருத வேண்டாம்.</p>'+
    steps([
        'Owner அனுமதியுடன் <b>System → Backup</b> screen-ல் database backup எடுக்கவும்.',
        'Original supplier PDFs/images-ன் தனி copy வைத்துக்கொள்ளவும்.',
        'Database backup மட்டும் போதாது. Owner / support உதவியுடன் company workspace-ன் <b>purchase-invoices</b> folder-ஐயும் copy எடுக்கவும்.',
        'Restore / company switch / update செய்வதற்கு முன் backup இருப்பதை உறுதிசெய்யவும்.',
    ])+
    note('Purchase files-ஐ நகர்த்த வேண்டாம்','App சேமித்த bill files-ஐ folder-ல் இருந்து rename/delete/move செய்ய வேண்டாம். File missing என்றால் பழைய reference இருந்தாலும் bill திறக்காது.')))

pages.append(section('16 பொதுவான சிக்கல்களுக்கு தீர்வு',
    'Error வந்தால் மீண்டும் financial entry செய்யும் முன் அதன் காரணத்தைச் சரிபார்க்கவும்.',
    table(['சிக்கல்','என்ன செய்ய வேண்டும்'],[
        ['Save & Receive Stock disabled','Supplier bill தேர்வு செய்யப்பட்டதா என்று பார்க்கவும். PDF/image upload இல்லாமல் save செய்ய முடியாது.'],
        ['Supplier bill upload is required','Bill upload செய்து retry செய்யவும். Existing order என்றால் active attachment இருக்கிறதா பார்க்கவும்.'],
        ['Selected bills expired / file missing','Bill file-ஐ மீண்டும் தேர்வு செய்யவும். Empty file அல்ல என்பதை உறுதிசெய்யவும்.'],
        ['Selling price missing','Product-க்கு common selling price இல்லை. Customer-க்கு விற்கும் விலையை உள்ளிடவும்.'],
        ['Supplier invoice already saved','Supplier + invoice number history search செய்யவும். அதே purchase-ஐ மீண்டும் உருவாக்க வேண்டாம்.'],
        ['Received quantity exceeds ordered','Receiving Now-ல் இந்த delivery quantity மட்டும் உள்ளதா பார்க்கவும்; Already Received-ஐ மீண்டும் சேர்க்க வேண்டாம்.'],
        ['Bill history empty','Purchase date மற்றும் uploaded date filters வேறுபட்டவை. Supplier/staff/type/status/search filters-ஐ clear செய்து பார்க்கவும்.'],
        ['Last bill cannot be removed','சரியான replacement bill upload செய்த பிறகு பழைய bill-ஐ remove செய்யவும்.'],
        ['Stock/profit 0 அல்லது unknown','Original batch cost இல்லாத historical records பற்றி warning இருக்கிறதா பார்க்கவும். புதிய receipt data-வுடன் மீண்டும் சரிபார்க்கவும்.'],
        ['Menu / cost / investment தெரியவில்லை','Role, Main Branch access, enabled module மற்றும் version-ஐ Company Admin சரிபார்க்க வேண்டும்.'],
    ],'faq')+
    note('Support-க்கு என்ன கொடுக்க வேண்டும்','Company/branch பெயர், product SKU, purchase/invoice number, error text மற்றும் screenshot கொடுக்கவும். Password அல்லது API key பகிர வேண்டாம்.')+
    '<p class="closing"><b>எளிய நடைமுறை</b><br>சரியான supplier + சரியான product + bill upload + உண்மையான quantity + சரியான purchase மற்றும் selling prices = நம்பகமான stock மற்றும் profit records.</p>'))

css = """
@page { size: A4; margin: 0; }
* { box-sizing: border-box; }
html,body { margin:0; padding:0; color:#18212d; background:#fff; font-family:'Nirmala UI','Segoe UI',sans-serif; font-size:11.2pt; line-height:1.52; }
.page { width:210mm; height:297mm; padding:14mm 16mm 16mm; position:relative; break-after:page; overflow:hidden; background:white; }
.page:last-child { break-after:auto; }
.running { font-family:'Segoe UI',sans-serif; color:#526072; font-size:8pt; letter-spacing:.07em; margin-bottom:6mm; }
.body { display:flow-root; }
h1 { font-size:20pt; line-height:1.45; margin:0 0 3mm; color:#000; font-weight:700; }
h2 { font-size:13pt; color:#173b73; line-height:1.4; margin:5mm 0 2.4mm; }
p { margin:0 0 3mm; }
.lead { color:#4c596a; margin-bottom:4mm; font-size:11.3pt; }
.eyebrow { font-family:'Segoe UI',sans-serif; font-size:9pt; letter-spacing:.17em; color:#285da1; margin-bottom:5mm; }
.cover-title { font-size:29pt; line-height:1.45; margin:0 0 2mm; }
.subtitle { font-family:'Segoe UI',sans-serif; font-size:16pt; color:#36465a; margin-bottom:2mm; }
.version { font-size:10pt; color:#536275; margin:0 0 5mm; }
.footer { position:absolute; left:16mm; right:16mm; bottom:8mm; display:flex; justify-content:space-between; color:#667284; font-family:'Segoe UI',sans-serif; font-size:8pt; padding-top:2mm; border-top:1px solid #dbe2e9; }
table { border-collapse:collapse; width:100%; margin:3mm 0; font-size:10.4pt; line-height:1.5; table-layout:fixed; }
th,td { padding:1.7mm 2.5mm; vertical-align:top; text-align:left; border:1px solid #d8e0e8; overflow-wrap:anywhere; }
th { font-size:9.7pt; background:#eef3f9; color:#203f64; font-weight:700; }
td:first-child { font-weight:600; }
thead { display:table-header-group; }
tr { break-inside:avoid; }
.steps { margin:2mm 0 4mm; padding-left:7mm; }
.steps li { padding-left:1mm; margin-bottom:2.7mm; }
.steps li::marker { color:#1d54a1; font-weight:700; }
aside { background:#f0f5fb; padding:3mm 3.5mm; border-left:3px solid #2d63b0; margin:4mm 0; font-size:10.4pt; line-height:1.52; break-inside:avoid; }
aside p { margin:1.3mm 0 0; }
aside strong { color:#173d74; }
.flow { display:flex; gap:2mm; margin:3mm 0 5mm; align-items:stretch; }
.flow span { flex:1; padding:2.4mm 2mm; border:1px solid #cbd8e9; background:#f4f7fb; font-size:9.5pt; font-weight:600; color:#244974; text-align:center; }
figure { margin:3mm 0 4mm; break-inside:avoid; }
figure img { width:100%; height:auto; display:block; border:1px solid #cdd6e1; object-fit:contain; }
figcaption { font-size:9pt; color:#59697e; line-height:1.5; margin-top:1.6mm; }
.wide img { max-height:50mm; }
.form-shot img { max-height:189mm; width:100%; }
.detail-shot img { max-height:83mm; }
.history-shot img { max-height:57mm; }
.faq th:first-child,.faq td:first-child { width:30%; }
.faq th:last-child,.faq td:last-child { width:70%; }
.profit-shot img { max-height:79mm; }
.investment-shot img { max-height:86mm; }
.path { color:#173d74; font-weight:600; background:#f2f6fb; padding:2.5mm 3mm; font-size:10.5pt; }
.toc { display:grid; grid-template-columns:1fr 1fr; gap:2mm 6mm; margin:3mm 0; }
.toc a { text-decoration:none; color:#253f60; display:flex; gap:3mm; font-size:10.1pt; line-height:1.55; padding:1mm 0; }
.toc b { color:#2d63b0; font-family:'Segoe UI',sans-serif; }
.numbers { display:grid; grid-template-columns:repeat(3,1fr); gap:3mm; margin:4mm 0; }
.numbers div { background:#eef5fa; border:1px solid #d3e2ee; padding:3mm; }
.numbers span { display:block; font-size:9.5pt; color:#486078; }
.numbers b { font-family:'Segoe UI',sans-serif; font-size:18pt; display:block; margin-top:1mm; color:#15466f; }
.closing { margin-top:4mm; font-size:10.6pt; }
"""
parts = []
for index, body in enumerate(pages, 1):
    parts.append(f'<section class="page" id="page-{index}"><div class="running">TK FRESH CHOICE &nbsp; / &nbsp; SUPERMARKET USER GUIDE</div><main class="body">{body}</main><footer class="footer"><span>Enterprise POS ERP | v2.9.4 | தமிழ் வழிகாட்டி</span><span>{index:02d} / {len(pages):02d}</span></footer></section>')
document = '<!doctype html><html lang="ta"><head><meta charset="utf-8"><title>Supermarket User Manual Tamil v2.9.4</title><style>'+css+'</style></head><body>'+''.join(parts)+'</body></html>'
(WORK / 'Supermarket_User_Manual_Tamil_v2.9.4.html').write_text(document, encoding='utf-8')
print(f'Authored {len(pages)} manual pages')
