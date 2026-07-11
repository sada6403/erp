import os

found = []
for root, dirs, files in os.walk(r'c:\Users\USER\OneDrive\Documents\Desktop\git\pos-erp\electron'):
    for file in files:
        if file.endswith(('.ts', '.tsx')):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            if 'audit_logs' in content or 'auditLog' in content:
                found.append(path)

print("Found audit_logs in electron:")
for f in found:
    print(f)
