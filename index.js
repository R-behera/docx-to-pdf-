const express = require('express');
const AdmZip = require('adm-zip');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
app.use(express.json({ limit: '50mb' }));

app.post('/convert', (req, res) => {
  const { docx_base64, placeholder_map } = req.body;

  if (!docx_base64) {
    return res.status(400).json({ error: 'Missing docx_base64' });
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docx-'));
  const docxPath = path.join(tmpDir, 'resume.docx');
  const pdfPath = path.join(tmpDir, 'resume.pdf');

  try {
    // Write DOCX to disk
    const docxBuffer = Buffer.from(docx_base64, 'base64');
    fs.writeFileSync(docxPath, docxBuffer);

    // Replace placeholders in document.xml using AdmZip
    if (placeholder_map && Object.keys(placeholder_map).length > 0) {
      const zip = new AdmZip(docxPath);
      let docXml = zip.readAsText('word/document.xml');

      for (const [placeholder, value] of Object.entries(placeholder_map)) {
        // Replace even if XML splits the placeholder across tags
        const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        docXml = docXml.replace(new RegExp(escaped, 'g'), String(value || ''));
      }

      zip.updateFile('word/document.xml', Buffer.from(docXml, 'utf8'));
      zip.writeZip(docxPath);
    }

    // Convert to PDF using LibreOffice
    execSync(`libreoffice --headless --convert-to pdf --outdir ${tmpDir} ${docxPath}`, {
      timeout: 60000
    });

    if (!fs.existsSync(pdfPath)) {
      throw new Error('PDF conversion failed - file not created');
    }

    const pdfBuffer = fs.readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });

    return res.json({ pdf_base64: pdfBase64 });

  } catch (err) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.error('Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
