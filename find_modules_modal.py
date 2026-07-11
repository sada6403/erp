with open(r'c:\Users\USER\OneDrive\Documents\Desktop\git\pos-erp\portals\superadmin\src\pages\CompaniesPage.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if 'showModules' in line or 'ModulesModal' in line:
        print(f"Line {idx+1}: {line.strip()}")
