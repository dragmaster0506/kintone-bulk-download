// =============================================================
// 添付ファイル階層ZIP一括ダウンロード
// desktop.js  ─  GitHub Pages で配信する本体スクリプト
//
// ★ このファイルを GitHub に上げ直すだけで全施設に反映されます
// =============================================================

(function () {
  'use strict';

  var VERSION = '1.0.2';

  // --------------------------------------------------
  // プラグイン設定を読み込む
  // GitHub Pages経由でもkintone.$PLUGIN_IDは正常に渡される
  // --------------------------------------------------
  function getConfig() {
    var pluginId = kintone.$PLUGIN_ID;
    if (!pluginId) {
      console.error('[bulk-download] プラグインIDが取得できませんでした。');
      return null;
    }
    var config = kintone.plugin.app.getConfig(pluginId);
    return {
      attachmentFieldCode : config.attachmentFieldCode || '',
      folderFieldCode     : config.folderFieldCode     || '',
      personFieldCode     : config.personFieldCode     || '',
      zipFileName         : config.zipFileName         || '添付ファイル一括ダウンロード',
      buttonLabel         : config.buttonLabel         || '一括ダウンロード',
      allowedViewIds      : parseViewIds(config.allowedViewIds || ''),
    };
  }

  function parseViewIds(str) {
    if (!str || str.trim() === '') return [];
    return str.split(',').map(function (s) {
      return parseInt(s.trim(), 10);
    }).filter(function (n) {
      return !isNaN(n);
    });
  }

  function getCurrentViewId() {
    var match = location.search.match(/[?&]view=(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  function isAllowedView(allowedViewIds) {
    if (allowedViewIds.length === 0) return true;
    return allowedViewIds.indexOf(getCurrentViewId()) !== -1;
  }

  function injectStyles() {
    if (document.getElementById('bulk-dl-plugin-style')) return;
    var style = document.createElement('style');
    style.id = 'bulk-dl-plugin-style';
    style.textContent = [
      '#bulk-dl-plugin-btn {',
      '  padding: 10px 16px;',
      '  background: #1e73be;',
      '  color: #fff;',
      '  font-size: 14px;',
      '  font-weight: bold;',
      '  border: 1px solid #1a63a3;',
      '  border-radius: 3px;',
      '  cursor: pointer;',
      '  margin-left: 8px;',
      '  transition: background 0.15s;',
      '}',
      '#bulk-dl-plugin-btn:hover:not(:disabled) { background: #1a63a3; }',
      '#bulk-dl-plugin-btn:disabled { background: #c8c8c8; border-color: #c8c8c8; cursor: not-allowed; }',
      '#bulk-dl-plugin-btn.kt-done { background: #3f9142; border-color: #357a38; }',
    ].join('\n');
    document.head.appendChild(style);
  }

  function showConfirmDialog(recordCount, fileCount, zipFileName) {
    return window.confirm([
      '以下の内容でZIPファイルを作成します。',
      '',
      '  対象レコード数 : ' + recordCount + ' 件',
      '  添付ファイル数 : ' + fileCount + ' 件',
      '  ZIPファイル名  : ' + zipFileName + '.zip',
      '',
      'ダウンロードを実行しますか？',
    ].join('\n'));
  }

  function toYearMonth(dateStr) {
    if (!dateStr) return '日付なし';
    var parts = dateStr.split('-');
    if (parts.length < 2) return '日付なし';
    return parts[0] + '年' + parts[1].padStart(2, '0') + '月';
  }

  function getFolderName(record, folderFieldCode) {
    if (!folderFieldCode) return '';
    var field = record[folderFieldCode];
    if (!field || !field.value) return '日付なし';
    return toYearMonth(field.value);
  }

  function getPersonName(record, personFieldCode) {
    if (!personFieldCode) return '';
    var field = record[personFieldCode];
    if (!field || !field.value) return '名前なし';
    return String(field.value).replace(/[/\\:*?"<>|]/g, '');
  }

  function deduplicateNames(files) {
    var countMap = {};
    return files.map(function (file) {
      var key   = file.zipPath;
      var count = countMap[key] || 0;
      countMap[key] = count + 1;
      if (count === 0) return file;
      var dot  = file.zipPath.lastIndexOf('.');
      var name = dot >= 0 ? file.zipPath.slice(0, dot) : file.zipPath;
      var ext  = dot >= 0 ? file.zipPath.slice(dot)    : '';
      return { zipPath: name + ' (' + count + ')' + ext, fileKey: file.fileKey };
    });
  }

  function collectFiles(records, config) {
    var files = [];
    records.forEach(function (record) {
      var attachField = record[config.attachmentFieldCode];
      if (!attachField || !attachField.value || attachField.value.length === 0) return;
      var folder = getFolderName(record, config.folderFieldCode);
      var person = getPersonName(record, config.personFieldCode);
      attachField.value.forEach(function (fileInfo) {
        var pathParts = [];
        if (folder) pathParts.push(folder);
        if (person) pathParts.push(person);
        pathParts.push(fileInfo.name);
        files.push({ zipPath: pathParts.join('/'), fileKey: fileInfo.fileKey });
      });
    });
    return files;
  }

  function getBaseQuery() {
    try {
      return kintone.app.getQueryCondition() || '';
    } catch (e) {
      console.warn('[bulk-download] getQueryCondition() 失敗。全件取得に切り替えます:', e.message);
      return '';
    }
  }

  async function getAllRecords(appId) {
    var allRecords = [];
    var offset    = 0;
    var limit     = 500;
    var baseQuery = getBaseQuery();
    while (true) {
      var query = (baseQuery ? baseQuery + ' ' : '') +
        'order by レコード番号 asc limit ' + limit + ' offset ' + offset;
      var response = await kintone.api(
        kintone.api.url('/k/v1/records', true), 'GET', { app: appId, query: query }
      );
      allRecords = allRecords.concat(response.records);
      if (response.records.length < limit) break;
      offset += limit;
    }
    return allRecords;
  }

  async function fetchFileBlob(fileKey) {
    var url = '/k/v1/file.json?fileKey=' + encodeURIComponent(fileKey);
    var response = await fetch(url, {
      method: 'GET',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (!response.ok) {
      throw new Error('ファイル取得失敗 (ステータス: ' + response.status + ')');
    }
    return await response.blob();
  }

  async function downloadAsZip(files, zipFileName, button) {
    var dedupedFiles = deduplicateNames(files);
    var zip   = new JSZip(); // eslint-disable-line no-undef
    var total = dedupedFiles.length;
    for (var i = 0; i < dedupedFiles.length; i++) {
      button.textContent = '取得中... ' + (i + 1) + '/' + total + '件';
      var blob = await fetchFileBlob(dedupedFiles[i].fileKey);
      zip.file(dedupedFiles[i].zipPath, blob);
    }
    button.textContent = 'ZIP生成中...';
    var zipBlob = await zip.generateAsync({ type: 'blob' });
    var url = URL.createObjectURL(zipBlob);
    var a   = document.createElement('a');
    a.href     = url;
    a.download = zipFileName + '.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function resetButton(button, label) {
    button.disabled = false;
    button.textContent = label;
  }

  kintone.events.on('app.record.index.show', async function (event) {

    var config = getConfig();
    if (!config) return event;
    if (!config.attachmentFieldCode) return event;
    if (!isAllowedView(config.allowedViewIds)) return event;
    if (document.getElementById('bulk-dl-plugin-btn')) return event;

    injectStyles();

    var headerSpace = kintone.app.getHeaderMenuSpaceElement();
    if (!headerSpace) return event;

    var button = document.createElement('button');
    button.id          = 'bulk-dl-plugin-btn';
    button.textContent = config.buttonLabel;
    button.title       = 'bulk-download-plugin v' + VERSION;

    button.addEventListener('click', async function () {
      button.disabled = true;
      var cfg = getConfig();
      if (!cfg) { resetButton(button, config.buttonLabel); return; }

      try {
        button.textContent = 'レコード取得中...';
        var records = await getAllRecords(kintone.app.getId());

        if (records.length === 0) {
          alert('対象のレコードがありません。');
          return resetButton(button, cfg.buttonLabel);
        }

        var files = collectFiles(records, cfg);
        if (files.length === 0) {
          alert('添付ファイルが見つかりませんでした。\nフィールドコード「' + cfg.attachmentFieldCode + '」を確認してください。');
          return resetButton(button, cfg.buttonLabel);
        }

        if (!showConfirmDialog(records.length, files.length, cfg.zipFileName)) {
          return resetButton(button, cfg.buttonLabel);
        }

        await downloadAsZip(files, cfg.zipFileName, button);

        button.classList.add('kt-done');
        button.textContent = 'ダウンロード完了';
        setTimeout(function () {
          button.classList.remove('kt-done');
          resetButton(button, cfg.buttonLabel);
        }, 3000);

      } catch (error) {
        console.error('[bulk-download] エラー:', error);
        alert('エラーが発生しました。\nF12 → コンソールタブで詳細を確認してください。\n\n' + error.message);
        resetButton(button, cfg.buttonLabel);
      }
    });

    headerSpace.appendChild(button);
    return event;
  });

})();
