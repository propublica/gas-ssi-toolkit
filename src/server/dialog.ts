/**
 * dialog.ts — HTML template for the AI source selection dialog.
 *
 * Stored as a template literal so Rollup can inline it. This is actually
 * cleaner than using HtmlService.createHtmlOutputFromFile() since that
 * requires a separate .html file which complicates the bundling.
 */

export const HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <style>
      body{font-family:'Google Sans',Arial,sans-serif;padding:20px;color:#202124;background:#fff}
      h3{margin-top:0;font-size:16px}
      .option{display:flex;align-items:flex-start;margin-bottom:12px;padding:10px;border:1px solid #e0e0e0;border-radius:8px;cursor:pointer;transition:0.2s}
      .option:hover{background:#f8f9fa;border-color:#1a73e8}
      .option input{margin:5px 12px 0 0;transform:scale(1.2)}
      .label-title{display:block;font-weight:500;font-size:14px;margin-bottom:4px}
      .label-desc{display:block;font-size:12px;color:#5f6368}
      .buttons{margin-top:24px;display:flex;justify-content:flex-end;gap:8px}
      button{padding:8px 24px;border-radius:4px;border:none;font-weight:500;cursor:pointer}
      .btn-cancel{background:#fff;color:#1a73e8;border:1px solid #dadce0}
      .btn-run{background:#1a73e8;color:#fff}
      .btn-run:hover{background:#1557b0}
    </style>
  </head>
  <body>
    <h3>Select Data Source</h3>
    <label class="option">
      <input type="radio" name="mode" value="TEXT" checked>
      <div><span class="label-title">Use Extracted Text</span><span class="label-desc">Fast. Reads "source_text". Best for plain text.</span></div>
    </label>
    <label class="option">
      <input type="radio" name="mode" value="FILE">
      <div>
        <span class="label-title">Use Drive File</span>
        <span class="label-desc">Multimodal. Reads PDFs, Images, Video, & Audio (max 25MB).</span>
      </div>
    </label>
    <div class="buttons">
      <button class="btn-cancel" onclick="google.script.host.close()">Cancel</button>
      <button class="btn-run" onclick="run()">Run AI</button>
    </div>
    <script>
      function run(){
        var m=document.querySelector('input[name="mode"]:checked').value;
        var b=document.querySelector('.btn-run');
        b.innerText='Starting...';b.disabled=true;
        google.script.run.withSuccessHandler(function(){google.script.host.close()}).handleDialogSelection(m);
      }
    </script>
  </body>
</html>`;
