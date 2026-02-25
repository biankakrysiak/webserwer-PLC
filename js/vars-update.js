/**
 * js/plc-update.js
 *
 * Pobiera index.html przez $.get() – serwer S7 podstawia wartości AWP.
 * Aktualizuje elementy #vd-* tylko gdy wartość się zmieniła.
 */

$(function () {

    var POLL_MS = 1000;

    /* nazwa (lowercase, bez spacji) → id elementu */
    var VAR_MAP = {
        'startplc':     'vd-startPlc',
        'zaklocenie01': 'vd-zaklocenie01',
        'start':        'vd-start',
        'stop':         'vd-stop',
        'starthmi':     'vd-startHMI',
        'zl':           'vd-ZL',
    };

    var prev = {};

    /* ── Parser: wyciąga "NAZWA :=WARTOŚĆ:" z div-ów ── */
    function parse(html) {
        var result = {};
        var re = /<div[^>]*>(.*?)<\/div>/gi;
        var m;
        while ((m = re.exec(html)) !== null) {
            var text = m[1].trim();
            var p = /^(.+?)\s*:=\s*([^:"]+?):?\s*$/.exec(text);
            if (!p) continue;
            var name = p[1].trim().toLowerCase().replace(/\s+/g, '');
            var val  = p[2].trim();
            result[name] = val;
        }
        return result;
    }

    /* ── Aktualizacja DOM – tylko zmienione ── */
    function apply(parsed) {
        var changed = false;
        $.each(parsed, function (name, val) {
            var id = VAR_MAP[name];
            if (!id) return;
            if (prev[name] === val) return;
            prev[name] = val;
            changed = true;

            var $el = $('#' + id);
            if (!$el.length) return;

            $el.text(val === '1' ? 'TRUE' : val === '0' ? 'FALSE' : val);
            $el.removeClass('val-true val-false');
            if      (val === '1') $el.addClass('val-true');
            else if (val === '0') $el.addClass('val-false');

            /* flash */
            $el.addClass('flash');
            setTimeout(function () { $el.removeClass('flash'); }, 500);
        });

        if (changed) {
            $('#last-change').text(new Date().toLocaleTimeString('pl-PL'));
        }
    }

    /* ── Polling ── */
    function poll() {
        $.ajax({
            url: window.location.href,
            cache: false,
            timeout: 3000,
            success: function (html) {
                setConn(true);
                apply(parse(html));
            },
            error: function () {
                setConn(false);
            }
        });
    }

    function setConn(ok) {
        $('#conn-dot').toggleClass('connected', ok).toggleClass('disconnected', !ok);
        $('#conn-label').text(ok ? 'POŁĄCZONY' : 'ROZŁĄCZONO');
    }

    /* ── Zegar ── */
    function clock() {
        var d = new Date();
        $('#clock-time').text(d.toLocaleTimeString('pl-PL'));
        $('#date-time').text(d.toLocaleDateString('pl-PL'));
    }
    setInterval(clock, 1000);
    clock();

    poll();
    setInterval(poll, POLL_MS);
});