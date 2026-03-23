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
        headers: { 'Authorization': 'Bearer ' + eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiJ9.eyJhdWQiOiIxIiwianRpIjoiZGVhMGVlMjVjNzBmMDUwOTkzMjA0MjU2OWU3YmI2ZDUyOWJhMGJlZjZhMDQ4YTc1YTRiYmY1MmRhZjdlYzg2ZjhhNGQwZGZmZjI2ODU2ODMiLCJpYXQiOjE3NzM5NzM3MzMuNjUzODk1LCJuYmYiOjE3NzM5NzM3MzMuNjUzODk2LCJleHAiOjQ5Mjk2NDczMzMuNjQ3MjI2LCJzdWIiOiI3NDc4MDE0MCIsInNjb3BlcyI6WyJ1c2VyLnJlYWQiLCJ1c2VyLndyaXRlIiwidGFzay5yZWFkIiwidGFzay53cml0ZSIsIndlYmhvb2sucmVhZCIsIndlYmhvb2sud3JpdGUiLCJwcmVzZXQucmVhZCIsInByZXNldC53cml0ZSJdfQ.JojVtIo36sw8zl6ssB7YV0YYTjWMr-h0bEcJ5l-uphYVUNQA7TBB09jktNgqBj2gzaLCF68NS2JjYtKiGGRA_WXAG4E_8-wr5iHSPQJBO-0IlDvLwgcu5O7OyL2Y4A8vNUXZu15iF6d_DXbpjIoAJNDWDGzpXfT7h3x2M7n1AsxvAQK7O-VUiyVfZcRIKeBHtrhTr5MxIJqBketKRdwa3lk_m0oOy1dTQ5yjy8SrpezEk4hey5cFKUIwEmJ2CCQhCFdY98df7eZWKk2r3xfWoxHAqXH_7Cuq1Zi6DF7pvvBYrCZOKk1M5M6ASzxRumUPhgwzX66bpY2AC8Ey2tg6GT-HaRc7HWBsK7d_S0GJSkBzoL_jmYOZIajW7G2m4eqBvmb0FbHH9FGg714dTqVAYyMJ0gC4BSq0nBPkGMDE1x5itP_19nt2slixtn7XY6Cz0rwIBWX9O_oP4l9nB9vx5fdg9-0Hoa8qpaupc7eZfw79i5KuTqCqdANekFTOkAJssR0IYMh8C2tA4be7R_5n10lSeMMtOBRtddWSaa2RenqxVW3m8ueLrLOMQwm9X7A20JYR0lPsJvXuwLbDUXLjCQgwaKJ7LXiVhJf_LU__Yp7_d1BeO1097K82ZEmcOq1f1PSGhGwsjP2pn32ZDbiaTopbvWNm7tI0IrFaZzdG9Jw }
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
