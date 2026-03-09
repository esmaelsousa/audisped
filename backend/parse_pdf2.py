from pypdf import PdfReader
reader = PdfReader("/Users/esmael/Library/CloudStorage/GoogleDrive-esmaelsousa@gmail.com/Meu Drive/audisped/speds/nova auditoria.pdf")
text = ""
for page in reader.pages:
    text += page.extract_text() + "\n"
print(text)
