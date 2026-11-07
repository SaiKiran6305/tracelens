/** Distributable, dependency-free SDK. Served verbatim; never embeds dashboard/server credentials. */
export const sdkSource = String.raw`(function (g) {
  "use strict";
  if (g.TraceLens && g.TraceLens.version === "2.0.0") return;
  var active = null;
  var uuid = function () { return crypto.randomUUID(); };
  function cleanPath(value) {
    try { return new URL(value, location.href).pathname.replace(/[a-f0-9]{8}-[a-f0-9-]{27}/ig, ":id").replace(/\/\d+(?=\/|$)/g, "/:id"); }
    catch (_) { return "/"; }
  }
  function metadata(value, schema) {
    var fields = {};
    Object.keys(schema || {}).slice(0, 20).forEach(function (key) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) return;
      var v = value && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
      fields[key] = { present: v !== undefined, empty: v == null || (typeof v === "string" && !v.trim()),
        type: v === null ? "null" : Array.isArray(v) ? "array" : typeof v, redacted: true };
    });
    return fields;
  }
  async function connect(options) {
    if (!options || options.consent !== true) throw new Error("Explicit recording consent is required.");
    var base = new URL(options.collectorUrl);
    if (base.search || base.hash || base.username || base.password ||
      !(base.protocol === "https:" || (base.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(base.hostname)))) {
      throw new Error("Use an explicit HTTPS collector URL without credentials, query, or hash.");
    }
    if (!options.projectId || !options.session) throw new Error("Project and scoped session are required.");
    if (active) {
      if (active.session === options.session && active.projectId === options.projectId) return active.api;
      throw new Error("Stop the active TraceLens recorder before connecting another session.");
    }
    var originalFetch = g.fetch;
    var sendFetch = originalFetch.bind(g);
    var collector = base.href.replace(/\/$/, "");
    async function send(path, data, keepalive) {
      var controller = new AbortController(), timeout = setTimeout(function () { controller.abort(); }, 12000);
      try {
        var r = await sendFetch(collector + path, { method: "POST", credentials: "omit",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + options.session },
          body: JSON.stringify(Object.assign({projectId: options.projectId}, data)), keepalive: !!keepalive, signal: controller.signal });
        if (!r.ok) { var error = new Error("Collector delivery failed (" + r.status + ")."); error.status = r.status; throw error; }
        return await r.json();
      } finally { clearTimeout(timeout); }
    }
    var clientId = uuid();
    var connected = await send("/connect", {clientId:clientId});
    if (connected.purpose === "verify") return { verified: true, runId: null, stop: async function () { return { complete: true }; } };
    var runId = connected.runId, stopped = false, suspended = false, queue = [], dropped = 0, work = null;
    var lastSequence = connected.lastSequence, current = null, warnings = [], stopWork = null, stoppedResult = null;
    var key = "tracelens.queue." + options.projectId + "." + runId;
    var maxQueue = Math.min(500, Math.max(25, options.maxQueue || 500));
    function warn(message) {
      if (warnings.indexOf(message) < 0) warnings.push(message);
      try { if (typeof options.onWarning === "function") options.onWarning(message); } catch (_) {}
      try { g.dispatchEvent(new CustomEvent("tracelens:warning", {detail: {message: message, runId: runId}})); } catch (_) {}
    }
    try {
      var saved = JSON.parse(sessionStorage.getItem(key) || "null");
      if (saved) { queue = Array.isArray(saved.queue) ? saved.queue.slice(0, maxQueue) : []; dropped = Number(saved.dropped) || 0; }
    } catch (_) { warn("Local recovery storage is unavailable. Keep this tab open until delivery finishes."); }
    function persist() {
      try { sessionStorage.setItem(key, JSON.stringify({ queue: queue, dropped: dropped, lastSequence: lastSequence })); }
      catch (_) { warn("Could not save the pending queue locally. Keep this tab open until delivery finishes."); }
    }
    function enqueue(event) {
      if (stopped) return null;
      if (queue.length >= maxQueue) { dropped++; persist(); warn("Recorder queue is full. Some events were dropped; this run cannot be a baseline."); return null; }
      var item = Object.assign({ eventId: uuid(), actionId: uuid(), stepId: "unassigned", kind: "navigation",
        label: "Application activity", recordedAt: new Date().toISOString() }, event);
      queue.push(item); persist();
      if (queue.length >= 25) void flush();
      return item.eventId;
    }
    async function flush(keepalive) {
      if (work) return work;
      work = (async function () {
        while (queue.length && !suspended) {
          var batch = queue.slice(0, 25), response = null;
          for (var attempt = 0; attempt < 4; attempt++) {
            try { response = await send("/events", {runId: runId, events: batch, dropped: dropped}, keepalive); break; }
            catch (error) {
              if (error.status === 401 || error.status === 403 || error.status === 409 || error.status === 413) {
                warn("Recording delivery is blocked. The session may be closed or its limit reached; pending evidence is retained.");
                return false;
              }
              if (attempt === 3 || keepalive) { warn("Collector unavailable. Pending evidence is saved in this tab and will retry."); return false; }
              await new Promise(function (resolve) { setTimeout(resolve, Math.min(8000, 300 * Math.pow(2, attempt))); });
            }
          }
          if (!response) return false;
          var acknowledged = new Set(response.accepted);
          queue = queue.filter(function (e) { return !acknowledged.has(e.eventId); });
          lastSequence = response.lastSequence; persist();
          if (batch.some(function (e) { return !acknowledged.has(e.eventId); })) { warn("Collector did not acknowledge all events."); return false; }
        }
        return queue.length === 0;
      })();
      try { return await work; } finally { work = null; }
    }
    function context(stepId, actionId, parentId) {
      var counts = {};
      return { stepId: stepId, actionId: actionId, parentId: parentId,
        fetch: function (input, init) { return instrumented(input, init, this); },
        outcome: function (outcome, label) {
          if (!/^[a-z][a-z0-9_-]{0,63}$/.test(outcome)) throw new Error("Outcome must be a declared semantic key.");
          enqueue({ kind: "outcome", stepId: stepId, actionId: actionId, parentId: parentId,
            label: String(label || outcome).slice(0, 150), response: {outcome: outcome, message: String(label || outcome).slice(0, 150)} });
        },
        counts: counts
      };
    }
    async function instrumented(input, init, ctx) {
      if (stopped) return originalFetch.call(g, input, init);
      var rawUrl;
      try { rawUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url; }
      catch (_) { return originalFetch.call(g, input, init); }
      var url;
      try { url = new URL(rawUrl, location.href); } catch (_) { return originalFetch.call(g, input, init); }
      if (url.origin === base.origin && url.pathname.indexOf(base.pathname) === 0) return originalFetch.call(g, input, init);
      var method = String(init && init.method || input && input.method || "GET").toUpperCase();
      if (!/^[A-Z]{1,12}$/.test(method)) method = "OTHER";
      ctx = ctx || current || context("unassigned", uuid(), null);
      var endpoint = method + " " + cleanPath(rawUrl);
      var attempt = (ctx.counts[endpoint] || 0) + 1; ctx.counts[endpoint] = attempt;
      var eventId = uuid(), start = performance.now(), requestFields;
      if (options.payloadSchema && options.payloadSchema.request && init && typeof init.body === "string" && init.body.length <= 8192) {
        try { requestFields = metadata(JSON.parse(init.body), options.payloadSchema.request); } catch (_) {}
      }
      var common = {eventId: eventId,kind:"api",stepId:ctx.stepId,actionId:ctx.actionId,traceId:ctx.actionId,
        parentId:ctx.parentId,method:method,path:cleanPath(rawUrl),attempt:attempt,
        label:(method + " " + cleanPath(rawUrl)).slice(0,150)};
      if (requestFields) common.request = {fields: requestFields};
      try {
        var response = await originalFetch.call(g, input, init);
        var detail = Object.assign({}, common, {status:response.status,durationMs:Math.max(0,performance.now()-start),recordedAt:new Date().toISOString()});
        // Response bodies are not consumed for recording by default. Opt-in small JSON schemas emit metadata ONLY.
        if (options.payloadSchema && options.payloadSchema.response &&
          /json/i.test(response.headers.get("content-type") || "") &&
          Number(response.headers.get("content-length") || 0) > 0 &&
          Number(response.headers.get("content-length")) <= 8192) {
          try { detail.response = {fields:metadata(await response.clone().json(), options.payloadSchema.response)}; } catch (_) {}
        }
        enqueue(detail);
        return response;
      } catch (error) {
        enqueue(Object.assign({},common,{status:0,durationMs:Math.max(0,performance.now()-start),recordedAt:new Date().toISOString()}));
        throw error;
      }
    }
    var wrapped = function (input, init) { return instrumented(input, init, current); };
    g.fetch = wrapped;
    var originalPush = history.pushState, originalReplace = history.replaceState;
    function nav() { enqueue({kind:"navigation",label:"Page changed",path:cleanPath(location.href),
      stepId:current ? current.stepId : "unassigned",actionId:current ? current.actionId : uuid(),parentId:current ? current.parentId : null}); }
    var push = function () { var result = originalPush.apply(history, arguments); nav(); return result; };
    var replace = function () { var result = originalReplace.apply(history, arguments); nav(); return result; };
    history.pushState = push; history.replaceState = replace;
    function onClick(event) {
      var target = event.target && event.target.closest && event.target.closest("[data-tracelens-step]");
      if (!target) return;
      var id = target.getAttribute("data-tracelens-step");
      if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id || "")) return;
      var label = target.getAttribute("data-tracelens-label") || id;
      var actionId = uuid(), parentId = enqueue({kind:"click",stepId:id,actionId:actionId,label:label.slice(0,150)});
      current = context(id,actionId,parentId);
      // Only same-task fetches inherit implicit click context. Async/parallel work must use explicit ctx.fetch.
      var selected = current;
      queueMicrotask(function () { if (current === selected) current = null; });
    }
    document.addEventListener("click",onClick,true);
    g.addEventListener("popstate",nav);
    g.addEventListener("hashchange",nav);
    var hide = function () { persist(); void flush(true); void send("/disconnect",{clientId:clientId},true).catch(function () {}); };
    var online = function () { void flush(); };
    g.addEventListener("pagehide",hide); g.addEventListener("online",online);
    var timer = setInterval(function () { void flush(); }, 1500);
    var heartbeat = setInterval(function () { void send("/heartbeat",{clientId:clientId}).catch(function () { warn("Connection heartbeat interrupted. Pending events remain in this tab."); }); }, 10000);
    function unpatch() {
      stopped = true; clearInterval(timer); clearInterval(heartbeat);
      if (g.fetch === wrapped) g.fetch = originalFetch;
      if (history.pushState === push) history.pushState = originalPush;
      if (history.replaceState === replace) history.replaceState = originalReplace;
      document.removeEventListener("click",onClick,true);
      g.removeEventListener("popstate",nav); g.removeEventListener("hashchange",nav);
      g.removeEventListener("pagehide",hide); g.removeEventListener("online",online);
      if (active && active.api === api) active = null;
    }
    var api = {
      runId: runId, verified: true,
      step: async function (stepId, fn, settings) {
        if (stopped) throw new Error("Recorder is stopped.");
        if (!/^[a-z][a-z0-9_-]{0,63}$/.test(stepId)) throw new Error("Use a declared semantic step identifier.");
        var actionId = settings && settings.actionId || uuid();
        var root = enqueue({kind:"click",stepId:stepId,actionId:actionId,label:String(settings && settings.label || stepId).slice(0,150)});
        var ctx = context(stepId,actionId,root), previous = current;
        current = ctx;
        function recordException() {
          // An application exception is observable failure, but its message may contain private data.
          enqueue({kind:"outcome",stepId:stepId,actionId:actionId,parentId:root,
            label:"Application step threw",response:{outcome:"exception",message:"Application step threw"}});
        }
        var result;
        try { result = fn(ctx); }
        catch (error) { recordException(); throw error; }
        finally { current = previous; }
        try { return await result; }
        catch (error) { recordException(); throw error; }
      },
      flush: flush,
      state: function () { return {runId:runId,pending:queue.length,dropped:dropped,lastSequence:lastSequence,warnings:warnings.slice(),stopped:stopped}; },
      stop: async function () {
        if (stopWork) return stopWork;
        if (stopped) return stoppedResult || {complete:false,stopped:true};
        stopWork = (async function () {
          var delivered = await flush(), finished = false;
          try {
            if (!delivered) return {complete:false,pending:queue.length,warning:"Pending evidence retained. Reconnect this session in this tab to resume delivery."};
            var result = await send("/finish",{runId:runId,clientId:clientId,complete:dropped===0,dropped:dropped});
            finished = true; stoppedResult = result;
            try { sessionStorage.removeItem(key); } catch (_) {}
            return result;
          } finally {
            if (!finished) void send("/disconnect",{clientId:clientId},true).catch(function () {});
            unpatch();
          }
        })();
        return stopWork;
      },
      // Unpatch without concluding: use for route teardown; reconnect with the same unexpired session to resume.
      detach: function () { if (stopped) return; persist(); void send("/disconnect",{clientId:clientId},true).catch(function () {}); unpatch(); }
    };
    active = {session:options.session,projectId:options.projectId,api:api};
    void flush();
    return api;
  }
  g.TraceLens = {version:"2.0.0",connect:connect};
})(window);
`;
