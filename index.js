const express = require('express');
const AdmZip = require('adm-zip');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '50mb' }));

const CC_API_KEY = process.env.CLOUDCONVERT_API_KEY;

app.post('/convert', async (req, res) => {
  const { docx_base64, placeholder_map } = req.body;

  if (!docx_base64) {
    return res.status(400).json({ error: 'Missing docx_base64' });
  }

  try {
    let docxBuffer = Buffer.from(docx_base64, 'base64');

    if (placeholder_map && Object.keys(placeholder_map).length > 0) {
      const zip = new AdmZip(docxBuffer);
      let docXml = zip.readAsText('word/document.xml');
      for (const [placeholder, value] of Object.entries(placeholder_map)) {
        const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        docXml = docXml.replace(new RegExp(escaped, 'g'), String(value || ''));
      }
      zip.updateFile('word/document.xml', Buffer.from(docXml, 'utf8'));
      docxBuffer = zip.toBuffer();
    }

    const jobRes = await fetch('https://api.cloudconvert.com/v2/jobs', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + CC_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tasks: {
          'import-file': {
            operation: 'import/base64',
            file: docxBuffer.toString('base64'),
            filename: 'resume.docx'
          },
          'convert-file': {
            operation: 'convert',
            input: 'import-file',
            input_format: 'docx',
            output_format: 'pdf'
          },
          'export-file': {
            operation: 'export/url',
            input: 'convert-file'
          }
        }
      })
    });

    const job = await jobRes.json();
    const jobId = job.data.id;

    let pdfUrl = null;
    for (var i = 0; i < 30; i++) {
      await new Promise(function(r) { setTimeout(r, 3000); });
      const statusRes = await fetch('https://api.cloudconvert.com/v2/jobs/' + jobId, {
        headers: { 'Authorization': 'Bearer ' + CC_API_KEY}
      });
      const status = await statusRes.json();
      const exportTask = status.data.tasks.find(function(t) {
        return t.operation === 'export/url' && t.result && t.result.files && t.result.files.length > 0;
      });
      if (exportTask) {
        pdfUrl = exportTask.result.files[0].url;
        break;
      }
      if (status.data.status === 'error') {
        return res.status(500).json({ error: 'CloudConvert job failed' });
      }
    }

    if (!pdfUrl) {
      return res.status(500).json({ error: 'Timeout waiting for PDF' });
    }

    const pdfRes = await fetch(pdfUrl);
    const pdfBuffer = await pdfRes.buffer();

    return res.json({ pdf_base64: pdfBuffer.toString('base64') });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

app.get('/health', function(req, res) {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log('Running on port ' + PORT);
});
