/* ============================================================================
 * JSON to TOON Converter - client-side tool logic
 * ----------------------------------------------------------------------------
 * Converts JSON to TOON (Token-Oriented Object Notation) entirely in the
 * browser. Tries to load an official TOON encoder from a CDN at runtime; if
 * none is available it falls back to a built-in encoder implementing core
 * TOON. Shows estimated token savings (JSON vs TOON). No server calls.
 * ========================================================================== */
(function () {
  "use strict";

  var mount = document.getElementById("tool");
  if (!mount) return;

  /* --------------------------------------------------------------------------
   * Built-in TOON encoder (fallback). Implements core TOON:
   *   - 2-space indentation per depth, "key: value" lines
   *   - strings unquoted unless they need quoting
   *   - arrays of uniform flat objects -> tabular: key[N]{c1,c2}: then rows
   *   - arrays of primitives -> key[N]: a,b,c
   *   - nested objects/arrays recurse with deeper indentation
   * ------------------------------------------------------------------------ */

  var KEYSEP = ""; // internal-only key-set separator (cannot occur in keys)

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }
  function isPrimitive(v) {
    return v === null || (typeof v !== "object" && typeof v !== "function");
  }

  // Format a primitive scalar (number/boolean/null) as TOON text.
  function formatScalar(v) {
    if (v === null) return "null";
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
    return String(v);
  }

  // Does a string need quoting in a plain (non-cell) context?
  function needsQuote(s) {
    if (s === "") return true;
    if (s !== s.trim()) return true; // leading/trailing whitespace
    if (/[",:\n\r\t{}\[\]]/.test(s)) return true;
    if (/^(true|false|null)$/i.test(s)) return true;
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) return true;
    return false;
  }

  function quote(s) {
    return '"' + s.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  }

  // Encode a string value for a plain key: value line.
  function encodeStringValue(s) {
    return needsQuote(s) ? quote(s) : s;
  }

  // Encode a value inside a comma-joined context (array of primitives or a
  // tabular cell). Commas/colons force quoting here too.
  function encodeCell(v) {
    if (isPrimitive(v) && typeof v !== "string") return formatScalar(v);
    var s = String(v);
    if (s === "" || s !== s.trim() ||
        /[",:\n\r\t{}\[\]]/.test(s) ||
        /^(true|false|null)$/i.test(s) ||
        /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) {
      return quote(s);
    }
    return s;
  }

  // Determine whether an array qualifies for tabular encoding: non-empty,
  // every element a plain object, all sharing the same key set, all values
  // primitive. Returns the ordered column list or null.
  function tabularColumns(arr) {
    if (!arr.length) return null;
    if (!isPlainObject(arr[0])) return null;
    var cols = Object.keys(arr[0]);
    if (!cols.length) return null;
    var colSet = cols.slice().sort().join(KEYSEP);
    for (var i = 0; i < arr.length; i++) {
      var obj = arr[i];
      if (!isPlainObject(obj)) return null;
      var keys = Object.keys(obj);
      if (keys.length !== cols.length) return null;
      if (keys.slice().sort().join(KEYSEP) !== colSet) return null;
      for (var k = 0; k < cols.length; k++) {
        if (!isPrimitive(obj[cols[k]])) return null;
      }
    }
    return cols;
  }

  function indent(depth) {
    return new Array(depth + 1).join("  ");
  }

  function encodeKeyName(key) {
    var s = String(key);
    return needsQuote(s) ? quote(s) : s;
  }

  // Encode `key: value` at the given depth, appending lines to `out`.
  function encodeKeyValue(key, value, depth, out) {
    var pad = indent(depth);
    var keyText = encodeKeyName(key);

    if (Array.isArray(value)) {
      encodeArray(keyText, value, depth, out);
      return;
    }
    if (isPlainObject(value)) {
      var keys = Object.keys(value);
      out.push(pad + keyText + ":");
      for (var i = 0; i < keys.length; i++) {
        encodeKeyValue(keys[i], value[keys[i]], depth + 1, out);
      }
      return;
    }
    // primitive
    if (typeof value === "string") {
      out.push(pad + keyText + ": " + encodeStringValue(value));
    } else {
      out.push(pad + keyText + ": " + formatScalar(value));
    }
  }

  function encodeArray(keyText, arr, depth, out) {
    var pad = indent(depth);

    if (!arr.length) {
      out.push(pad + keyText + "[0]:");
      return;
    }

    // All primitives -> inline comma list
    var allPrim = true;
    for (var i = 0; i < arr.length; i++) {
      if (!isPrimitive(arr[i])) { allPrim = false; break; }
    }
    if (allPrim) {
      var cells = [];
      for (var p = 0; p < arr.length; p++) cells.push(encodeCell(arr[p]));
      out.push(pad + keyText + "[" + arr.length + "]: " + cells.join(","));
      return;
    }

    // Uniform flat objects -> tabular
    var cols = tabularColumns(arr);
    if (cols) {
      var header = pad + keyText + "[" + arr.length + "]{" +
        cols.map(encodeKeyName).join(",") + "}:";
      out.push(header);
      var rowPad = indent(depth + 1);
      for (var r = 0; r < arr.length; r++) {
        var row = [];
        for (var c = 0; c < cols.length; c++) {
          row.push(encodeCell(arr[r][cols[c]]));
        }
        out.push(rowPad + row.join(","));
      }
      return;
    }

    // Mixed / nested array -> list form, one entry per element.
    out.push(pad + keyText + "[" + arr.length + "]:");
    var elPad = indent(depth + 1);
    for (var e = 0; e < arr.length; e++) {
      var el = arr[e];
      if (Array.isArray(el)) {
        encodeArray("-", el, depth + 1, out);
      } else if (isPlainObject(el)) {
        var ks = Object.keys(el);
        out.push(elPad + "-");
        for (var ki = 0; ki < ks.length; ki++) {
          encodeKeyValue(ks[ki], el[ks[ki]], depth + 2, out);
        }
      } else if (typeof el === "string") {
        out.push(elPad + "- " + encodeStringValue(el));
      } else {
        out.push(elPad + "- " + formatScalar(el));
      }
    }
  }

  // Top-level encode for the built-in encoder.
  function builtinEncode(data) {
    var out = [];
    if (Array.isArray(data)) {
      encodeArray("data", data, 0, out);
    } else if (isPlainObject(data)) {
      var keys = Object.keys(data);
      for (var i = 0; i < keys.length; i++) {
        encodeKeyValue(keys[i], data[keys[i]], 0, out);
      }
    } else if (typeof data === "string") {
      out.push(encodeStringValue(data));
    } else {
      out.push(formatScalar(data));
    }
    return out.join("\n");
  }

  /* --------------------------------------------------------------------------
   * Optional official TOON encoder (loaded from CDN at runtime, best-effort).
   * ------------------------------------------------------------------------ */

  var officialEncode = null;          // function(data) -> string, or null
  var encoderLabel = "built-in encoder";

  function pickEncodeFn(m) {
    if (!m) return null;
    var candidates = [m.encode, m.stringify, m.toon,
      m.default && m.default.encode, m.default && m.default.stringify,
      typeof m.default === "function" ? m.default : null];
    for (var i = 0; i < candidates.length; i++) {
      if (typeof candidates[i] === "function") return candidates[i];
    }
    return null;
  }

  // Wrap dynamic import so environments without ESM import support degrade
  // gracefully instead of throwing.
  function importModule(url) {
    try {
      return import(url);
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function loadOfficialEncoder() {
    var sources = [
      "https://esm.sh/@toon-format/toon",
      "https://esm.sh/@toon/toon",
      "https://esm.sh/toon-format"
    ];

    function tryNext(i) {
      if (i >= sources.length) return Promise.resolve(null);
      return importModule(sources[i])
        .then(function (m) {
          var fn = pickEncodeFn(m);
          if (fn) return { fn: fn, src: sources[i] };
          return tryNext(i + 1);
        })
        .catch(function () { return tryNext(i + 1); });
    }

    return tryNext(0).then(function (result) {
      if (result) {
        officialEncode = function (data) {
          var r = result.fn(data);
          return typeof r === "string" ? r : String(r);
        };
        encoderLabel = "official TOON library (" +
          result.src.replace("https://esm.sh/", "") + ")";
      }
    }).catch(function () { /* keep built-in */ });
  }

  /* --------------------------------------------------------------------------
   * Conversion + token estimate
   * ------------------------------------------------------------------------ */

  function estimateTokens(text) {
    return Math.ceil((text || "").length / 4);
  }

  function toon(data) {
    if (officialEncode) {
      try {
        return officialEncode(data);
      } catch (e) {
        return builtinEncode(data); // fall back silently on library error
      }
    }
    return builtinEncode(data);
  }

  /* --------------------------------------------------------------------------
   * UI
   * ------------------------------------------------------------------------ */

  mount.innerHTML = "";

  var ui = document.createElement("div");
  ui.innerHTML = [
    '<div class="dropzone" id="toon-drop" tabindex="0" role="button" ',
    '     aria-label="Drop a .json file here or click to browse">',
    "  Drop a <strong>.json</strong> file here, or click to browse - or just paste below.",
    "</div>",
    '<input type="file" id="toon-file" accept=".json,application/json" hidden>',

    '<label for="toon-input" style="display:block;margin:14px 0 6px;font-weight:600;">JSON input</label>',
    '<textarea id="toon-input" spellcheck="false" autocomplete="off" ',
    '          placeholder=\'{ "users": [ { "id": 1, "name": "Ada" }, { "id": 2, "name": "Linus" } ] }\'></textarea>',

    '<div class="controls">',
    '  <button type="button" id="toon-sample" class="secondary">Load sample</button>',
    '  <button type="button" id="toon-clear" class="secondary">Clear</button>',
    "</div>",

    '<div id="toon-savings" aria-live="polite"></div>',

    '<div class="output">',
    '  <label for="toon-output" style="display:block;margin:6px 0;font-weight:600;">TOON output</label>',
    '  <textarea id="toon-output" readonly spellcheck="false" aria-label="TOON output" style="background:#fff;"></textarea>',
    '  <div class="controls">',
    '    <button type="button" id="toon-copy">Copy TOON</button>',
    '    <button type="button" id="toon-download" class="secondary">Download .toon</button>',
    "  </div>",
    '  <p id="toon-encoder-note" class="notice" style="margin-top:6px;"></p>',
    '  <div id="toon-error" role="alert"></div>',
    "</div>"
  ].join("\n");
  mount.appendChild(ui);

  var dropzone = ui.querySelector("#toon-drop");
  var fileInput = ui.querySelector("#toon-file");
  var input = ui.querySelector("#toon-input");
  var output = ui.querySelector("#toon-output");
  var savings = ui.querySelector("#toon-savings");
  var errorBox = ui.querySelector("#toon-error");
  var encoderNote = ui.querySelector("#toon-encoder-note");
  var copyBtn = ui.querySelector("#toon-copy");
  var downloadBtn = ui.querySelector("#toon-download");
  var sampleBtn = ui.querySelector("#toon-sample");
  var clearBtn = ui.querySelector("#toon-clear");

  var SAMPLE = JSON.stringify({
    users: [
      { id: 1, name: "Ada Lovelace", role: "admin", active: true },
      { id: 2, name: "Linus Torvalds", role: "maintainer", active: true },
      { id: 3, name: "Grace Hopper", role: "admin", active: false }
    ],
    page: 1,
    total: 3,
    tags: ["alpha", "beta", "release-candidate"]
  }, null, 2);

  function setError(msg) {
    if (!msg) { errorBox.innerHTML = ""; return; }
    errorBox.innerHTML = '<div class="error"></div>';
    errorBox.firstChild.textContent = msg;
  }

  function setEncoderNote() {
    encoderNote.textContent = "Converted using the " + encoderLabel + ".";
  }

  function renderSavings(jsonText, toonText) {
    var jt = estimateTokens(jsonText);
    var tt = estimateTokens(toonText);
    var pct = jt > 0 ? Math.round((1 - tt / jt) * 100) : 0;
    var color = pct > 0 ? "#16a34a" : (pct < 0 ? "#b91c1c" : "var(--muted)");
    var verdict = pct > 0 ? (pct + "% saved")
      : (pct < 0 ? (Math.abs(pct) + "% larger") : "no change");
    savings.innerHTML = [
      '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;',
      'background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-top:6px;">',
      '  <span><strong>JSON</strong>: ~', jt, ' tokens</span>',
      '  <span><strong>TOON</strong>: ~', tt, ' tokens</span>',
      '  <span style="font-weight:700;color:', color, ';">', verdict, '</span>',
      "</div>"
    ].join("");
  }

  function clearSavings() { savings.innerHTML = ""; }

  function convert() {
    var text = input.value;
    setEncoderNote();
    if (!text.trim()) {
      output.value = "";
      setError("");
      clearSavings();
      return;
    }
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      output.value = "";
      clearSavings();
      setError("That doesn't look like valid JSON: " + e.message);
      return;
    }
    setError("");
    var result;
    try {
      result = toon(data);
    } catch (e) {
      output.value = "";
      clearSavings();
      setError("Could not convert this JSON to TOON: " + e.message);
      return;
    }
    output.value = result;
    renderSavings(text, result);
  }

  var debounceTimer = null;
  function scheduleConvert() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(convert, 200);
  }

  input.addEventListener("input", scheduleConvert);

  // File handling
  function readFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      input.value = String(reader.result || "");
      convert();
    };
    reader.onerror = function () { setError("Could not read that file."); };
    try {
      reader.readAsText(file);
    } catch (e) {
      setError("Could not read that file.");
    }
  }

  dropzone.addEventListener("click", function () { fileInput.click(); });
  dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) readFile(fileInput.files[0]);
    fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add("dragover");
    });
  });
  ["dragleave", "dragend", "drop"].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove("dragover");
    });
  });
  dropzone.addEventListener("drop", function (e) {
    var dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) {
      readFile(dt.files[0]);
    } else if (dt) {
      var t = dt.getData("text");
      if (t) { input.value = t; convert(); }
    }
  });

  // Copy
  copyBtn.addEventListener("click", function () {
    var text = output.value;
    if (!text) return;
    var done = function () {
      var orig = copyBtn.textContent;
      copyBtn.textContent = "Copied!";
      setTimeout(function () { copyBtn.textContent = orig; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        fallbackCopy(text, done);
      });
    } else {
      fallbackCopy(text, done);
    }
  });

  function fallbackCopy(text, done) {
    try {
      output.focus();
      output.select();
      document.execCommand("copy");
      done();
    } catch (e) {
      setError("Copy failed - please select the output and copy manually.");
    }
  }

  // Download
  downloadBtn.addEventListener("click", function () {
    var text = output.value;
    if (!text) return;
    try {
      var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = "data.toon";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } catch (e) {
      setError("Download failed in this browser.");
    }
  });

  sampleBtn.addEventListener("click", function () {
    input.value = SAMPLE;
    convert();
  });
  clearBtn.addEventListener("click", function () {
    input.value = "";
    output.value = "";
    setError("");
    clearSavings();
    setEncoderNote();
    input.focus();
  });

  // Initial state - render note, then try to upgrade to the official encoder.
  setEncoderNote();
  loadOfficialEncoder().then(function () {
    setEncoderNote();
    if (input.value.trim()) convert(); // re-render with official output if loaded
  });
})();
