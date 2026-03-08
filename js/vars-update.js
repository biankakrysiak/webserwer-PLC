/**
  js/plc-update.js
  
  Odświeżanie zmiennych PLC - Siemens S7-1200, format AWP.
 
  Zasada działania:
    index.html zawiera ukryty blok z div-ami AWP.
    Serwer S7 przy każdym GET podstawia wartości:
      <div>startPlc :="TrybSterowania_DB".startPlc:</div>
                                     ↓ po podstawieniu S7:
      <div>startPlc :=1:</div>
 
    Skrypt co POLL_MS pobiera window.location.href (tę samą stronę),
    parsuje div-y i aktualizuje DOM tylko gdy wartość się zmieniła.
 */

$(function () {
    'use strict';

    var POLL_MS   = 3000;  // ms - interwał odpytywania S7 (S7-1200 jest powolny ~2.4s)
    var CHART_MAX = 60;    // maks. punktów na wykresie
    var LOG_MAX   = 80;    // maks. wpisów w dzienniku
    var eventCount = 0;
    var remoteMode = false;  /* zapamiętaj tryb między pollami */

    /* 
       MAPA: nazwa AWP (lowercase, bez spacji) → id elementu
       Klucze muszą odpowiadać nazwie zmiennej po lewej stronie
       `:=` w div-ach AWP, zamienionej na lowercase.
     */
    var VAR_MAP = {
        /* Default tag table - wejścia fizyczne */
        'zwiekszplc':         'vd-ZwiekszPLC',
        'zmniejszplc':        'vd-ZmniejszPLC',
        'zaklocenie01':       'vd-zaklocenie01',
        'manualpotencjometr': 'vd-ManualPotencjometr',
        'obrotyenkodera':     'vd-ObrotyEnkodera',
        'startplc':           'vd-startPlc',
        /* TrybSterowania_DB [DB3] - Input FB1 */
        'zwiekszaplc':        'vd-zwiekszaPlc',
        'zmniejszaplc':       'vd-zmniejszaPlc',
        'zl':                 'vd-ZL',
        'starthmi':           'vd-startHMI',
        'zwiekszhmi':         'vd-zwiekszHMI',
        'zaklocenie01db':     'vd-zaklocenie01DB',
        'zmniejszhmi':        'vd-zmniejszHMI',
        /* TrybSterowania_DB [DB3] - Output FB1 */
        'start':              'vd-start',
        'stop':               'vd-stop',
        'zwieksz':            'vd-zwieksz',
        'zmniejsz':           'vd-zmniejsz',
        /* Default tag table - markery i pomiary */
        'sprzeg':             'vd-Sprzeg',
        'potencjo':           'vd-Potencjo',
        'stanpotencjometru':  'vd-StanPotencjometru',
        'poziom':             'vd-Poziom',
        'obortypamiec':       'vd-ObortyPamiec',
        'permin':             'vd-perMin',
        'perliter':           'vd-perLiter',
        'obrotyint':          'vd-ObrotyInt',
        'obrotyreal':         'vd-ObrotyReal',
        'obrotysuma':         'vd-ObrotySuma',
        'obecnaliczbacykli':  'vd-ObecnaLiczbaCykli',
        'buforzaklocen':      'vd-buforzaklocen',
        'zaklocenie22001':    'vd-zaklocenie22001',
    };

    /* Kopia poprzednich wartości */
    var prev = {};

    /* ══════════════════════════════════════════════
       PARSER - wyciąga wartości z div-ów AWP

       S7 AWP przed podstawieniem (w pliku HTML):
         <div>startPlc :="TrybSterowania_DB".startPlc:</div>
         <div>zaklocenie01 :="zaklocenie01":</div>

       S7 AWP po podstawieniu (w odpowiedzi GET):
         <div>startPlc :=1:</div>
         <div>zaklocenie01 :=0:</div>

       Wzorzec do wyciągnięcia wartości:
         NazwaKlucza :=WARTOŚĆ:
         ──────────────────────
         Klucz  = wszystko przed " :="
         Wartość = wszystko między ":=" a ostatnim ":"
    ══════════════════════════════════════════════ */
    function parse(html) {
        var result = {};

        /*
          Format AWP po podstawieniu przez S7-1200:
            <div>startPlc 1</div>
            <div>Poziom 0.1248913</div>
         
          S7 zastępuje całe ":=\"Tag\":" samą wartością,
          zostawiając: "NazwaKlucza WARTOŚĆ"
         */
        var re = /<div[^>]*>([^<]*)<\/div>/gi;
        var m;

        while ((m = re.exec(html)) !== null) {
            var text = m[1].trim();

            /* Format: "Nazwa wartość" - nazwa bez spacji, wartość po spacji */
            var p = /^([A-Za-z0-9_]+) (.+)$/.exec(text);
            if (!p) continue;

            var name = p[1].toLowerCase();
            var val  = p[2].trim();

            result[name] = val;
        }

        return result;
    }

    /* ══════════════════════════════════════════════
       AKTUALIZACJA DOM - tylko zmienione wartości
    ══════════════════════════════════════════════ */
    function apply(parsed) {
        var anyChange = false;

        $.each(parsed, function (name, val) {
            var id = VAR_MAP[name];
            if (!id) return;
            if (prev[name] === val) return; /* brak zmiany - pomiń */
            prev[name] = val;
            anyChange  = true;

            var $el = $('#' + id);
            if (!$el.length) return;

            /* Tekst wyświetlany */
            var displayed;
            var num = Number(val);
            var isBool = $el.hasClass('bool-val');

            if (isBool && !isNaN(num)) {
                displayed = num === 1 ? 'TRUE' : 'FALSE';
            } else {
                var n = parseFloat(val);
                displayed = (!isNaN(n) && val.indexOf('.') !== -1)
                    ? n.toFixed(3)
                    : val;
            }

            $el.text(displayed);

            /* Klasy CSS */
            $el.removeClass('val-true val-false val-num');
            if (isBool && !isNaN(num)) {
                $el.addClass(num === 1 ? 'val-true' : 'val-false');
            } else {
                $el.addClass('val-num');
            }

            /* Flash na wierszu */
            var $row = $el.closest('.var-row');
            if ($row.length) {
                $row.addClass('flash');
                setTimeout(function () { $row.removeClass('flash'); }, 600);
            }

            /* Efekty boczne */
            sideEffect(name, val);
        });

        if (anyChange) {
            $('#last-change').text(new Date().toLocaleTimeString('pl-PL'));
            eventCount++;
            $('#event-count').text('Zdarzenia: ' + eventCount);
        }

        pushChart(
            parseFloat(prev['permin']   || '0'),
            parseFloat(prev['perliter'] || '0'),
            parseFloat(prev['potencjo'] || '0') / 100
        );
    }

    /*
       EFEKTY BOCZNE
    */
    function sideEffect(name, val) {
        var on = (val === '1');
        switch (name) {
            case 'sprzeg':
                setLamp('lamp-praca', on);
                rotatePump(on);
                addLog('Sprzeg → ' + (on ? 'PRACA' : 'STOP'), on ? 'ok' : 'warn', 'SPRZEG');
                break;
            case 'stop':
                setLamp('lamp-stop', on);
                break;
            case 'zl':
                setLamp('lamp-zdalne', on);
                break;
            case 'zaklocenie01':
                setLamp('lamp-alarm', on);
                $('#svg-fault').toggleClass('hidden', !on);
                $('#alarm-banner').toggleClass('hidden', !on);
                if (on) addLog('ZAKŁÓCENIE 01 aktywne!', 'error', 'ALARM');
                else    addLog('Zakłócenie 01 skasowane', 'ok',    'ALARM');
                break;
            case 'zaklocenie22001':
                setLamp('lamp-zakl22', on);
                break;
            case 'potencjo':
                var v = parseInt(val) || 0;
                $('#slider-pot').not(':active').val(v);
                $('#slider-disp').text(v);
                break;
            case 'start':
                if (on) addLog('Sygnał START aktywny', 'ok', 'START');
                break;
        }
    }

    /* Lampa */
    function setLamp(id, on) {
        $('#' + id + ' .lamp-bulb').toggleClass('on', on);
    }

    /*  Wirnik SVG  */
    function rotatePump(running) {
        var $r = $('#pump-rotor');
        var $c = $('#svg-pump-circle');
        $r.removeClass('spinning spinning-slow');
        if (running) {
            var pot = parseInt(prev['potencjo'] || '200');
            $r.addClass(pot > 13800 ? 'spinning' : 'spinning-slow');
        }
        $c.toggleClass('running', running);
    }

    /* 
       DZIENNIK ZDARZEŃ
    */
    function addLog(msg, type, tag) {
        type = type || 'info';
        tag  = tag  || '-';
        var ts = new Date().toLocaleTimeString('pl-PL');
        var $entry = $('<div class="log-entry ' + type + '">' +
            '<span class="log-ts">'  + ts  + '</span>' +
            '<span class="log-tag">' + tag + '</span>' +
            '<span class="log-msg">' + msg + '</span>' +
        '</div>');
        var $list = $('#log-list');
        $list.prepend($entry);
        while ($list.children().length > LOG_MAX) {
            $list.children().last().remove();
        }
    }

    window.clearLog = function () {
        $('#log-list').empty();
        eventCount = 0;
        $('#event-count').text('Zdarzenia: 0');
    };

    /* 
       WYKRES CANVAS
    */
    var chartData = { rpm: [], liter: [], pot: [] };
    var canvas, ctx;

    function initChart() {
        canvas = document.getElementById('trend-chart');
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        resizeChart();
        window.addEventListener('resize', resizeChart);
    }

    function resizeChart() {
        if (!canvas) return;
        var p = canvas.parentElement;
        canvas.width  = p.offsetWidth  - 20;
        canvas.height = p.offsetHeight - 20;
        drawChart();
    }

    function pushChart(rpm, liter, pot) {
        chartData.rpm.push(rpm);
        chartData.liter.push(liter);
        chartData.pot.push(pot);
        if (chartData.rpm.length > CHART_MAX) {
            chartData.rpm.shift();
            chartData.liter.shift();
            chartData.pot.shift();
        }
        drawChart();
    }

    function drawChart() {
        if (!ctx) return;
        var W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        ctx.fillStyle = '#0a0e14';
        ctx.fillRect(0, 0, W, H);

        /* Siatka */
        ctx.strokeStyle = 'rgba(36,48,64,.8)';
        ctx.lineWidth = 1;
        for (var i = 0; i <= 5; i++) {
            var y = Math.round(H * i / 5) + .5;
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
        for (var j = 0; j <= 10; j++) {
            var x = Math.round(W * j / 10) + .5;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }

        var n = chartData.rpm.length;
        if (n < 2) {
            ctx.fillStyle = 'rgba(120,150,170,.4)';
            ctx.font = '12px Share Tech Mono, monospace';
            ctx.textAlign = 'center';
            ctx.fillText('Brak danych - oczekiwanie na PLC...', W / 2, H / 2);
            return;
        }

        var all    = chartData.rpm.concat(chartData.liter).concat(chartData.pot);
        var maxVal = Math.max.apply(null, all) * 1.15 || 1;

        function line(data, color) {
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth   = 2;
            ctx.lineJoin    = 'round';
            ctx.shadowColor = color;
            ctx.shadowBlur  = 6;
            ctx.beginPath();
            data.forEach(function (v, i) {
                var px = (i / (n - 1)) * W;
                var py = H - (v / maxVal) * H;
                i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
            });
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
            var rgb = color.match(/\d+/g);
            ctx.fillStyle = 'rgba(' + rgb.join(',') + ',0.06)';
            ctx.fill();
            ctx.restore();
        }

        line(chartData.rpm,   'rgb(0,212,255)');
        line(chartData.liter, 'rgb(0,230,118)');
        line(chartData.pot,   'rgb(255,215,64)');

        function dot(data, color) {
            var py = H - (data[data.length - 1] / maxVal) * H;
            ctx.save();
            ctx.fillStyle = color; ctx.strokeStyle = '#0a0e14'; ctx.lineWidth = 1.5;
            ctx.shadowColor = color; ctx.shadowBlur = 8;
            ctx.beginPath(); ctx.arc(W, py, 4, 0, Math.PI * 2);
            ctx.fill(); ctx.stroke();
            ctx.restore();
        }
        dot(chartData.rpm,   '#00d4ff');
        dot(chartData.liter, '#00e676');
        dot(chartData.pot,   '#ffd740');
    }

    window.clearChart = function () {
        chartData.rpm = []; chartData.liter = []; chartData.pot = [];
        drawChart();
    };

    /* TRYB ZDALNY / LOKALNY */
    window.setMode = function (remote) {
        remoteMode = remote;
        $('#mode-badge').text(remote ? 'ZDALNY' : 'LOKALNY').toggleClass('remote', remote);
        $('#btn-local').toggleClass('active', !remote);
        $('#btn-remote').toggleClass('active',  remote);
        $('#mode-info').text(remote
            ? '✔ Sterowanie z WWW AKTYWNE'
            : 'ℹ Sterowanie WWW wymaga trybu ZDALNEGO');
        $('#ctrl-start, #ctrl-stop, #ctrl-up, #ctrl-down, #ctrl-set, #ctrl-reset')
            .prop('disabled', !remote);
        $('#slider-pot').prop('disabled', !remote);
        addLog(remote ? 'Tryb ZDALNY aktywny' : 'Tryb LOKALNY', remote ? 'ok' : 'warn', 'TRYB');
    };

    /* WSKAŹNIK POŁĄCZENIA */
    function setConn(ok) {
        $('#conn-dot').removeClass('connected disconnected').addClass(ok ? 'connected' : 'disconnected');
        $('#conn-label').text(ok ? 'POŁĄCZONY' : 'ROZŁĄCZONO');
        $('.connection-indicator').removeClass('connected disconnected').addClass(ok ? 'connected' : 'disconnected');
    }

    /* ZEGAR */
    function clock() {
        var d = new Date();
        $('#clock-time').text(d.toLocaleTimeString('pl-PL'));
        $('#date-time').text(d.toLocaleDateString('pl-PL'));
    }
    setInterval(clock, 1000);
    clock();

    /* 
       POLLING - pobieramy TĘ SAMĄ STRONĘ
       S7 każdorazowo podstawia wartości AWP w div-ach
    */
    /* Czysty URL - bez parametrów GET które S7 dodaje po submit formularza */
    var POLL_URL = window.location.protocol + '//' + window.location.host + window.location.pathname;

    function poll() {
        $.ajax({
            url:     POLL_URL,
            cache:   false,
            timeout: 8000,
            success: function (html) {
                setConn(true);

                var parsed = parse(html);
                apply(parsed);
                /* Przywróć tryb zdalny jeśli był aktywny przed pollem */
                if (remoteMode) {
                    $('#ctrl-start, #ctrl-stop, #ctrl-up, #ctrl-down, #ctrl-set, #ctrl-reset').prop('disabled', false);
                    $('#slider-pot').prop('disabled', false);
                }
            },
            error: function (xhr, status, err) {
                setConn(false);
                addLog('Brak odpowiedzi S7: ' + status, 'error', 'POLL');
                console.warn('[POLL] błąd:', status, err, 'URL:', POLL_URL);
            }
        });
    }

    /* START */
    initChart();
    addLog('Webserwer uruchomiony', 'ok', 'SYSTEM');
    addLog('Oczekiwanie na dane S7...', 'info', 'SYSTEM');
    poll();
    setInterval(poll, POLL_MS);

    console.info('[plc-update] start · polling co', POLL_MS, 'ms');
});