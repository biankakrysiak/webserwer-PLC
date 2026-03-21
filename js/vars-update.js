/*
  js/vars-update.js
  Siemens S7-1200 AWP - polling + sterowanie przez GET
 
  LOGIKA ZL:
    ZL = 1  ->  tryb LOKALNY (sterowanie z PLC / fizyczne przyciski)
    ZL = 0  ->  tryb ZDALNY  (sterowanie z HMI/WWW przez startHMI, zwiekszHMI itp.)
 
  LOGIKA START/STOP (Network 1/2):
    start = (startPlc AND ZL) OR (startHMI AND NOT ZL)
    stop  = (NOT startPlc AND ZL) OR (NOT startHMI AND NOT ZL) OR zaklocenie01
 
    Oznacza to że startHMI działa jako sygnał POZIOMOWY:
      startHMI=1 -> pompa jedzie   (w trybie zdalnym)
      startHMI=0 -> pompa stoi     (w trybie zdalnym)
    Wartość MUSI być przechowywana po stronie JS i wysyłana przy każdym pollingu!
 */

$(function () {
    'use strict';

    var POLL_MS   = 3000;
    var CHART_MAX = 60;
    var LOG_MAX   = 80;
    var eventCount = 0;

    /*
     remoteMode: czy jesteśmy w trybie zdalnym (WWW)
     Uwaga: ZL=0 w PLC oznacza ZDALNY, ZL=1 oznacza LOKALNY
     JS sessionStorage przechowuje '1' gdy zdalny, '0' gdy lokalny
     */
    var remoteMode = (sessionStorage.getItem('remoteMode') === '1');

    /*
      startHMI_state: zapamiętana wartość startHMI (0 lub 1)
      PLC wymaga sygnału poziomowego - musimy go utrzymywać po stronie JS
      i dołączać do każdego pollingu gdy jesteśmy w trybie zdalnym.
     */
    var startHMI_state = parseInt(sessionStorage.getItem('startHMI_state') || '0');

    var prev = {};

    var POLL_URL = window.location.pathname.replace(/\/\//g, '/');

    var VAR_MAP = {
        'startplc':           'vd-startPlc',
        'zwiekszplc':         'vd-ZwiekszPLC',
        'zmniejszplc':        'vd-ZmniejszPLC',
        'zaklocenie01':       'vd-zaklocenie01',
        'manualpotencjometr': 'vd-ManualPotencjometr',
        'obrotyenkodera':     'vd-ObrotyEnkodera',
        'zwiekszaplc':        'vd-zwiekszaPlc',
        'zmniejszaplc':       'vd-zmniejszaPlc',
        'zl':                 'vd-ZL',
        'starthmi':           'vd-startHMI',
        'zwiekszhmi':         'vd-zwiekszHMI',
        'zaklocenie01db':     'vd-zaklocenie01DB',
        'zmniejszhmi':        'vd-zmniejszHMI',
        'start':              'vd-start',
        'stop':               'vd-stop',
        'zwieksz':            'vd-zwieksz',
        'zmniejsz':           'vd-zmniejsz',
        'sprzeg':             'vd-Sprzeg',
        'potencjo':           'vd-Potencjo',
        'stanpotencjometru':  'vd-StanPotencjometru',
        'poziom':             'vd-Poziom',
        'obortypamiec':       'vd-ObortyPamiec',
        'permin':             'vd-perMin',
        'perliter':           'vd-perLiter',
        'obrotyint':          'vd-ObrotyInt',
        'obrotyreal':         'vd-ObrotyReal',
        'litry':              'vd-litry',
        'obecnaliczbacykli':  'vd-ObecnaLiczbaCykli',
        'buforzaklocen':      'vd-buforzaklocen',
        'zaklocenie22001':    'vd-zaklocenie22001'
    };

    /* PARSER AWP */
    function parse(html) {
        var result = {};

        /* FORMAT A: <div>startPlc :=1:</div> */
        var reA = /<div[^>]*>\s*([A-Za-z0-9_]+)\s*:=([-0-9.e+]+):\s*<\/div>/gi;
        var m;
        while ((m = reA.exec(html)) !== null) {
            result[m[1].toLowerCase()] = m[2].trim();
        }

        /* FORMAT B: <div>startPlc 1</div> */
        var reB = /<div[^>]*>\s*([A-Za-z0-9_]+)\s+([-0-9.e+]+)\s*<\/div>/gi;
        while ((m = reB.exec(html)) !== null) {
            var key = m[1].toLowerCase();
            if (!result[key]) {
                result[key] = m[2].trim();
            }
        }

        return result;
    }

    /* AKTUALIZACJA DOM */
    function apply(parsed) {
        var anyChange = false;
        $.each(parsed, function (name, val) {
            var id = VAR_MAP[name];
            if (!id) return;
            if (prev[name] === val) return;
            prev[name] = val;
            anyChange = true;

            /*
             sideEffect ZAWSZE przed sprawdzeniem DOM.
             Wiele kluczowych tagow (sprzeg, poziom, permin, potencjo, obrotyenkodera)
             nie ma elementow w tabeli HTML - ale wizualizacja SVG ich potrzebuje.
             */
            sideEffect(name, val);

            var $el = $('#' + id);
            if (!$el.length) return;   /* brak w tabeli - pomijamy tylko aktualizacje DOM */

            var num    = Number(val);
            var isBool = $el.hasClass('bool-val');
            var displayed;

            if (isBool && !isNaN(num)) {
                displayed = num === 1 ? 'TRUE' : 'FALSE';
            } else {
                var n = parseFloat(val);
                displayed = (!isNaN(n) && val.indexOf('.') !== -1) ? n.toFixed(3) : val;
            }

            $el.text(displayed);
            $el.removeClass('val-true val-false val-num');
            if (isBool && !isNaN(num)) {
                $el.addClass(num === 1 ? 'val-true' : 'val-false');
            } else {
                $el.addClass('val-num');
            }

            var $row = $el.closest('.var-row');
            if ($row.length) {
                $row.addClass('flash');
                setTimeout(function () { $row.removeClass('flash'); }, 600);
            }
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
        updateViz();
    }

    /* EFEKTY BOCZNE */
    function sideEffect(name, val) {
        var on = (val === '1');
        switch (name) {
            case 'sprzeg':
                setLamp('lamp-praca', on);
                rotatePump(on);
                addLog('Sprzeg -> ' + (on ? 'PRACA' : 'STOP'), on ? 'ok' : 'warn', 'SPRZEG');
                break;

            case 'start':
                /* Jesli brak sprzeg, uzyj 'start' do animacji pompy */
                if (prev['sprzeg'] === undefined || prev['sprzeg'] === '0') {
                    setLamp('lamp-praca', on);
                    rotatePump(on);
                }
                if (on) addLog('Sygnał START aktywny', 'ok', 'START');
                break;

            case 'stop':
                setLamp('lamp-stop', on);
                break;

            case 'zl':
                /*
                 ZL=1 -> LOKALNY (sterowanie z PLC)
                 ZL=0 -> ZDALNY  (sterowanie z HMI/WWW)
                 
                 Synchronizujemy UI z rzeczywistym stanem ZL z PLC.
                 */
                var isRemoteFromPLC = (val === '0');  /* ZL=0 = zdalny */
                _syncRemoteUI(isRemoteFromPLC);
                addLog('PLC: tryb ' + (isRemoteFromPLC ? 'ZDALNY ✔' : 'LOKALNY'), isRemoteFromPLC ? 'ok' : 'warn', 'TRYB');
                break;

            case 'zaklocenie01':
                setLamp('lamp-alarm', on);
                $('#svg-fault').toggleClass('hidden', !on);
                $('#alarm-banner').toggleClass('hidden', !on);
                if (on) addLog('ZAKŁÓCENIE 01 aktywne!', 'error', 'ALARM');
                else    addLog('Zakłócenie 01 skasowane', 'ok',    'ALARM');
                break;

            case 'potencjo':
                var v = parseInt(val) || 0;
                $('#slider-pot').not(':active').val(v);
                $('#slider-disp').text(v);
                break;



            case 'starthmi':
                /* synchronizuj zapamiętany stan startHMI z wartością odczytaną z PLC */
                startHMI_state = parseInt(val) || 0;
                sessionStorage.setItem('startHMI_state', startHMI_state);
                _updateStartStopButtons();
                break;
        }
    }

    /* aktualizuje wygląd przycisków START/STOP na podstawie startHMI_state */
    function _updateStartStopButtons() {
        var running = (startHMI_state === 1);
        $('#ctrl-start').toggleClass('active-cmd', running);
        $('#ctrl-stop').toggleClass('active-cmd', !running);
    }

    /* synchronizuje UI przycisków z faktycznym stanem trybu */
    function _syncRemoteUI(remote) {
        remoteMode = remote;
        sessionStorage.setItem('remoteMode', remote ? '1' : '0');
        $('#mode-badge').text(remote ? 'ZDALNY' : 'LOKALNY').toggleClass('remote', remote);
        $('#btn-local').toggleClass('active', !remote);
        $('#btn-remote').toggleClass('active', remote);
        $('#ctrl-start, #ctrl-stop, #ctrl-up, #ctrl-down, #ctrl-set, #ctrl-reset')
            .prop('disabled', !remote);
        $('#slider-pot').prop('disabled', !remote);
        if (remote) { _updateStartStopButtons(); }
    }

    function setLamp(id, on) {
        $('#' + id + ' .lamp-bulb').toggleClass('on', on);
    }

    /* ANIMACJA WIRNIKA - setInterval
       co 30ms obracamy pump-rotor o odpowiedni kat
       predkosc zalezna od potencjometru
     */
    var _rotorAngle   = 0;
    var _rotorTimer   = null;
    var _rotorRunning = false;

    function _rotorTick() {
        var pot = parseInt(prev['potencjo'] || '0');
        /* predkosc: od 60 deg/s (pot=0) do 720 deg/s (pot=27600), tick co 30ms */
        var degsPerTick = (60 + (pot / 27600) * 660) * 0.030;
        _rotorAngle = (_rotorAngle + degsPerTick) % 360;
        var rotor = document.getElementById('pump-rotor');
        if (rotor) { rotor.setAttribute('transform', 'rotate(' + _rotorAngle.toFixed(1) + ')'); }
    }

    function rotatePump(running) {
        var $c = $('#svg-pump-circle');
        $c.toggleClass('running', running);
        if (running === _rotorRunning) return;
        _rotorRunning = running;
        console.log('[ROTOR] running=' + running);
        if (running) {
            if (!_rotorTimer) {
                console.log('[ROTOR] start timer');
                _rotorTimer = setInterval(_rotorTick, 30);
            }
        } else {
            if (_rotorTimer) { clearInterval(_rotorTimer); _rotorTimer = null; }
            var rotor = document.getElementById('pump-rotor');
            if (rotor) { rotor.setAttribute('transform', 'rotate(0)'); }
        }
    }

    /* SYMULACJA POZIOMU ZBIORNIKOW
      
      zbiornik lewy startuje pelny (100%).
      gdy pompa pracuje (sprzeg=1): lewy sie oproznia, prawy sie napelnia
      predkosc przeplywu jest proporcjonalna do permin (RPM pompy)
      gdy pompa stoi: poziomy sie nie zmieniaja
      gdy lewy osiagnie 0% lub prawy 100%: pompa nie ma co pompowac
      
      wartosci sa symulacyjne po stronie JS - nie ida do PLC
      POLL_MS = 3000ms - aktualizujemy poziomy co poll.
     */
    var _tankIn  = 1.0;   /* 0.0 - 1.0, startuje pelny */
    var _tankOut = 0.0;   /* 0.0 - 1.0, startuje pusty */
    var _tankLastTs = null;

    /* stala przeplywu: ile procent zbiornika na sekunde przy 1000 RPM */
    var FLOW_PCT_PER_RPM_PER_SEC = 0.0002;    /* 0.02%/s na 100RPM, ~3%/s na 1500RPM */

    /* pompa pracuje gdy sprzeg=1 LUB start=1 (fallback gdy brak sprzeg) */
    function _isRunning() {
        if (prev['sprzeg'] === '1') return true;
        if (prev['start']  === '1') return true;
        return false;
    }

    function _updateTankLevels() {
        var running = _isRunning();
        var now = Date.now();
        if (_tankLastTs === null) { _tankLastTs = now; }
        var dt = (now - _tankLastTs) / 1000.0;
        _tankLastTs = now;

        if (running && dt > 0 && dt < 10) {
            /* Predkosc przeplywu:
               1) jesli enkoder dziala - uzyj permin (RPM z PLC)
               2) jesli brak permin - skaluj wg potencjometru (0..27600 -> 200..2000 RPM)
               3) absolutny fallback: 1000 RPM
             */
            var rpm = parseFloat(prev['permin'] || '0');
            if (rpm < 1) {
                var pot = parseInt(prev['potencjo'] || '0');
                rpm = 200 + (pot / 27600) * 1800;  /* 200..2000 RPM wg potencjometru */
            }
            var flow = rpm * FLOW_PCT_PER_RPM_PER_SEC * dt;
            flow = Math.max(0, Math.min(flow, _tankIn, 1.0 - _tankOut));
            _tankIn  = Math.max(0, _tankIn  - flow);
            _tankOut = Math.min(1, _tankOut + flow);
        }
    }

    function updateViz() {
        _updateTankLevels();
        var running = _isRunning();
        /* synchronizuj wirnik z aktualnym stanem - niezaleznie od sideEffect */
        rotatePump(running);

        /* zbiornik wejsciowy */
        var inH = Math.round(_tankIn * 166);
        $('#tank-fluid-in').attr({ y: 198 - inH, height: inH });
        $('#tank-level-txt').text((_tankIn * 100).toFixed(1) + ' %');

        /* zbiornik wyjsciowy */
        var outH = Math.round(_tankOut * 166);
        $('#tank-fluid-out').attr({ y: 198 - outH, height: outH });
        $('#tank-out-level-txt').text((_tankOut * 100).toFixed(1) + ' %');

        /* pompa RPM */
        var rpm = parseFloat(prev['permin'] || '0');
        $('#pump-rpm-txt').text(rpm.toFixed(0) + ' rpm');

        /* enkoder - surowe zliczenia */
        $('#viz-encoder-txt').text(parseInt(prev['obrotyenkodera'] || '0'));

        /* potencjometr */
        var pot    = parseInt(prev['potencjo'] || '0');
        var potPct = Math.max(0, Math.min(1, pot / 27600));
        $('#viz-pot-txt').text(pot);
        $('#viz-pot-bar').attr('width', (potPct * 40).toFixed(1));

        /* rury animowane gdy pompa pracuje */
        $('#pipe-in-fluid, #pipe-v-in-fluid, #pipe-v-out-fluid, #pipe-out-fluid')
            .attr('stroke-opacity', running ? '0.9' : '0');

        /* lampki */
        setLampColor('lamp-praca',  _isRunning(),                    '#00e676');
        setLampColor('lamp-stop',   prev['stop']         === '1',    '#ff5252');
        setLampColor('lamp-alarm',  prev['zaklocenie01'] === '1',    '#ff5252');
        setLampColor('lamp-zdalne', prev['zl']           === '0',    '#ffd740');
    }

    function setLampColor(id, on, color) {
        $('#' + id + ' .lamp-bulb')
            .css({
                'background': on ? color : '',
                'box-shadow': on ? '0 0 8px ' + color + ', 0 0 18px ' + color + '55' : ''
            })
            .toggleClass('on', on);
    }

    /* TRYB ZDALNY / LOKALNY
      ZL=0 -> ZDALNY (WWW steruje), ZL=1 -> LOKALNY (PLC steruje)
      Wysyłamy ZL do PLC. UI odblokuje się natychmiast,
      ale zostanie zsynchronizowane też przy odpowiedzi PLC (sideEffect 'zl').
     */
    window.setMode = function (remote) {
        _syncRemoteUI(remote);
        addLog(remote ? 'Tryb ZDALNY - sterowanie aktywne' : 'Tryb LOKALNY', remote ? 'ok' : 'warn', 'TRYB');

        /* ZL=0 dla ZDALNEGO, ZL=1 dla LOKALNEGO */
        var zlValue = remote ? '0' : '1';
        var param = encodeURIComponent('"TrybSterowania_DB".ZL') + '=' + zlValue;

        /* gdy wchodzimy w tryb lokalny, wyzeruj startHMI żeby pompa nie ruszyła sama */
        if (!remote) {
            startHMI_state = 0;
            sessionStorage.setItem('startHMI_state', '0');
        }

        $.ajax({
            url:     POLL_URL + '?' + param,
            method:  'GET',
            cache:   false,
            timeout: 5000,
            success: function (html) {
                setConn(true);
                apply(parse(html));
                addLog('PLC potwierdził ZL=' + zlValue + ' (' + (remote ? 'ZDALNY' : 'LOKALNY') + ')', 'ok', 'TRYB');
            },
            error: function (xhr, status) {
                addLog('ZL niedostępne do zapisu (' + status + ') - sterowanie i tak aktywne', 'warn', 'TRYB');
            }
        });
    };

    /* AJAX SEND
       Wysyła formularz do PLC: GET /strona.html?"DB".tag=wartość
       TYPY SYGNAŁÓW:
         startHMI  -> POZIOMOWY: zapamiętujemy stan i wysyłamy przy każdym pollingu
         zwiekszHMI/zmniejszHMI -> IMPULSOWE: wysyłamy 1, po odpowiedzi PLC wysyłamy 0
         pozostałe -> jednorazowe (potencjo, zaklocenie reset)
       IMPULS dla zwiększ/zmniejsz:
         Krok 1: wyślij tag=1 do PLC
         Krok 2: po sukcesie wyślij tag=0 (kasowanie impulsu)
         PLC widzi zbocze 0->1 i wykonuje akcję, potem wróci do 0
     */
    var _sendBusy = false;

    /* tagi które wymagają impulsu (wysłanie 1 a potem automatyczne 0) */
    var PULSE_TAGS = ['"TrybSterowania_DB".zwiekszHMI', '"TrybSterowania_DB".zmniejszHMI'];

    /* wysyła pojedynczy parametr GET do PLC (wewnętrzna funkcja) */
    function _ajaxSend(params, label, onSuccess, onComplete) {
        $.ajax({
            url:     POLL_URL + '?' + params,
            method:  'GET',
            cache:   false,
            timeout: 8000,
            success: function (html) {
                setConn(true);
                apply(parse(html));
                if (onSuccess) onSuccess(html);
                addLog('✔ PLC ok: ' + label, 'ok', 'SEND');
            },
            error: function (xhr, status) {
                setConn(false);
                addLog('✘ Błąd: ' + status + ' | ' + label, 'error', 'SEND');
                if (onComplete) onComplete();
            },
            complete: function () {
                if (onComplete) onComplete();
            }
        });
    }

    window.plcSend = function (form) {
        if (_sendBusy) {
            addLog('Poprzednie polecenie w toku - poczekaj...', 'warn', 'SEND');
            return;
        }

        var params  = $(form).serialize();
        var decoded = decodeURIComponent(params);

        if (!params) {
            addLog('BŁĄD: pusty formularz - sprawdź type="hidden" w inputach', 'error', 'SEND');
            return;
        }

        /* zapamiętaj stan startHMI jeśli to formularz START/STOP */
        if (decoded.indexOf('startHMI') !== -1) {
            var match = decoded.match(/startHMI[^=]*=\s*([01])/i);
            if (match) {
                startHMI_state = parseInt(match[1]);
                sessionStorage.setItem('startHMI_state', startHMI_state);
                addLog('startHMI_state zapamiętany: ' + startHMI_state, 'info', 'SEND');
            }
        }

        _sendBusy = true;
        var $btns = $('#ctrl-start, #ctrl-stop, #ctrl-up, #ctrl-down, #ctrl-set, #ctrl-reset');
        $btns.prop('disabled', true);

        addLog('-> ' + decoded, 'info', 'SEND');

        /* sprawdź czy to tag impulsowy (zwiększ/zmniejsz) */
        var isPulse = false;
        var pulseTagRaw = null;
        for (var pi = 0; pi < PULSE_TAGS.length; pi++) {
            var tagEncoded = encodeURIComponent(PULSE_TAGS[pi]);
            if (params.indexOf(tagEncoded) !== -1) {
                isPulse = true;
                pulseTagRaw = PULSE_TAGS[pi];
                break;
            }
        }

        function _done() {
            _sendBusy = false;
            if (remoteMode) { $btns.prop('disabled', false); }
            _updateStartStopButtons();
        }

        if (isPulse) {
            /*
             IMPULS: wyślij tag=1, a po odpowiedzi PLC wyślij tag=0
             To symuluje zbocze narastające + opadające, tak jak fizyczny przycisk
             */
            _ajaxSend(params, decoded, function () {
                /* Sukces - teraz każ PLC=0 (kasowanie impulsu) */
                var resetParams = encodeURIComponent(pulseTagRaw) + '=0';
                addLog('Kasowanie impulsu: ' + pulseTagRaw + '=0', 'info', 'SEND');
                _ajaxSend(resetParams, pulseTagRaw + '=0', null, _done);
            }, function () {
                /* Błąd przy wysyłaniu 1 - i tak spróbuj wyzerować */
                var resetParams = encodeURIComponent(pulseTagRaw) + '=0';
                _ajaxSend(resetParams, pulseTagRaw + '=0 (po błędzie)', null, _done);
            });
        } else {
            /* Normalny send - jednorazowy */
            _ajaxSend(params, decoded, null, _done);
        }
    };

    /* WSKAŹNIK POŁĄCZENIA */
    function setConn(ok) {
        $('#conn-dot').removeClass('connected disconnected').addClass(ok ? 'connected' : 'disconnected');
        $('#conn-label').text(ok ? 'POŁĄCZONY' : 'ROZŁĄCZONO');
        $('.connection-indicator').removeClass('connected disconnected').addClass(ok ? 'connected' : 'disconnected');
    }

    /* DZIENNIK */
    function addLog(msg, type, tag) {
        type = type || 'info'; tag = tag || '-';
        var $entry = $('<div class="log-entry ' + type + '">' +
            '<span class="log-ts">'  + new Date().toLocaleTimeString('pl-PL') + '</span>' +
            '<span class="log-tag">' + tag + '</span>' +
            '<span class="log-msg">' + msg + '</span></div>');
        var $list = $('#log-list');
        $list.prepend($entry);
        while ($list.children().length > LOG_MAX) { $list.children().last().remove(); }
    }
    window.clearLog = function () {
        $('#log-list').empty(); eventCount = 0; $('#event-count').text('Zdarzenia: 0');
    };

    /* WYKRES */
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
        canvas.width  = canvas.parentElement.offsetWidth  - 20;
        canvas.height = canvas.parentElement.offsetHeight - 20;
        drawChart();
    }
    function pushChart(rpm, liter, pot) {
        chartData.rpm.push(rpm); chartData.liter.push(liter); chartData.pot.push(pot);
        if (chartData.rpm.length > CHART_MAX) { chartData.rpm.shift(); chartData.liter.shift(); chartData.pot.shift(); }
        drawChart();
    }
    function drawChart() {
        if (!ctx) return;
        var W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#0a0e14'; ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = 'rgba(36,48,64,.8)'; ctx.lineWidth = 1;
        for (var i = 0; i <= 5; i++) { var y = Math.round(H*i/5)+.5; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
        for (var j = 0; j <= 10; j++) { var x = Math.round(W*j/10)+.5; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
        var n = chartData.rpm.length;
        if (n < 2) {
            ctx.fillStyle='rgba(120,150,170,.4)'; ctx.font='12px Share Tech Mono,monospace'; ctx.textAlign='center';
            ctx.fillText('Brak danych - oczekiwanie na PLC...', W/2, H/2); return;
        }
        var all = chartData.rpm.concat(chartData.liter).concat(chartData.pot);
        var maxVal = Math.max.apply(null, all) * 1.15 || 1;
        function line(data, color) {
            ctx.save(); ctx.strokeStyle=color; ctx.lineWidth=2; ctx.lineJoin='round';
            ctx.shadowColor=color; ctx.shadowBlur=6; ctx.beginPath();
            data.forEach(function(v,i){ var px=(i/(n-1))*W, py=H-(v/maxVal)*H; i===0?ctx.moveTo(px,py):ctx.lineTo(px,py); });
            ctx.stroke(); ctx.shadowBlur=0;
            ctx.lineTo(W,H); ctx.lineTo(0,H); ctx.closePath();
            var rgb=color.match(/\d+/g); ctx.fillStyle='rgba('+rgb.join(',')+',0.06)'; ctx.fill(); ctx.restore();
        }
        line(chartData.rpm,'rgb(0,212,255)'); line(chartData.liter,'rgb(0,230,118)'); line(chartData.pot,'rgb(255,215,64)');
        function dot(data,color){ var py=H-(data[data.length-1]/maxVal)*H; ctx.save(); ctx.fillStyle=color; ctx.strokeStyle='#0a0e14'; ctx.lineWidth=1.5; ctx.shadowColor=color; ctx.shadowBlur=8; ctx.beginPath(); ctx.arc(W,py,4,0,Math.PI*2); ctx.fill(); ctx.stroke(); ctx.restore(); }
        dot(chartData.rpm,'#00d4ff'); dot(chartData.liter,'#00e676'); dot(chartData.pot,'#ffd740');
    }
    window.clearChart = function () { chartData.rpm=[]; chartData.liter=[]; chartData.pot=[]; drawChart(); };

    /* reset zbiornikow do stanu poczatkowego (lewy pelny, prawy pusty) */
    window.resetTanks = function () {
        _tankIn  = 1.0;
        _tankOut = 0.0;
        _tankLastTs = null;
        prev['litry'] = '0';
        $('#vd-litry').text('0').removeClass('val-true val-false').addClass('val-num');
        console.log('[TANK] reset: in=1.0 out=0.0');
        updateViz();
        addLog('Zbiorniki zresetowane: lewy 100%, prawy 0%, litry 0', 'ok', 'VIZ');
    };

    /* ZEGAR */
    function clock() { var d=new Date(); $('#clock-time').text(d.toLocaleTimeString('pl-PL')); $('#date-time').text(d.toLocaleDateString('pl-PL')); }
    setInterval(clock, 1000); clock();

    /* POLLING
       KLUCZOWE: gdy jesteśmy w trybie zdalnym, dołączamy do każdego
       pollingu aktualny stan startHMI_state. Dzięki temu PLC
       (który potrzebuje sygnału poziomowego) zawsze wie czy pompa
       ma pracować czy stać
     */
    var _pollTimer = null;
    var _pollBusy  = false;

    function poll() {
        if (_pollBusy) return;
        _pollBusy = true;

        /* buduj URL pollingu */
        var pollUrl = POLL_URL;

        if (remoteMode) {
            /*
             W trybie zdalnym dołącz startHMI do każdego pollingu.
             PLC odświeży wartość tagu startHMI przy GET - to utrzymuje
             sygnał poziomowy aktywny nawet jeśli strona się odświeża.
             */
            var startParam = encodeURIComponent('"TrybSterowania_DB".startHMI') + '=' + startHMI_state;
            pollUrl = POLL_URL + '?' + startParam;
        }

        $.ajax({
            url: pollUrl, method: 'GET', cache: false, timeout: 8000,
            success: function (html) {
                setConn(true);

                /* DEBUG */
                var awpBlock = html.match(/display:none[\s\S]*?<\/div>\s*<\/div>/i);
                if (awpBlock) { console.log('[AWP raw]', awpBlock[0].substring(0, 400)); }

                apply(parse(html));

                if (remoteMode) {
                    $('#ctrl-start, #ctrl-stop, #ctrl-up, #ctrl-down, #ctrl-set, #ctrl-reset').prop('disabled', false);
                    $('#slider-pot').prop('disabled', false);
                }
            },
            error: function (xhr, status, err) {
                setConn(false);
                addLog('Brak odpowiedzi S7: ' + status, 'error', 'POLL');
                console.warn('[POLL] błąd:', status, err, 'URL:', pollUrl);
            },
            complete: function () {
                _pollBusy = false;
                _pollTimer = setTimeout(poll, POLL_MS);
            }
        });
    }

    /* START */
    initChart();
    if (remoteMode) {
        $('#mode-badge').text('ZDALNY').addClass('remote');
        $('#btn-local').removeClass('active');
        $('#btn-remote').addClass('active');
        $('#ctrl-start, #ctrl-stop, #ctrl-up, #ctrl-down, #ctrl-set, #ctrl-reset').prop('disabled', false);
        $('#slider-pot').prop('disabled', false);
        _updateStartStopButtons();
    }
    updateViz();   /* narysuj zbiorniki od razu - lewy pelny */
    addLog('Webserwer uruchomiony · ' + POLL_URL, 'ok', 'SYSTEM');
    addLog('Logika ZL: ZL=0->ZDALNY, ZL=1->LOKALNY', 'info', 'SYSTEM');
    addLog('Oczekiwanie na dane S7...', 'info', 'SYSTEM');
    poll();
    console.info('[vars-update] POLL_URL:', POLL_URL, '· co', POLL_MS, 'ms');
    console.info('[vars-update] ZL logika: ZL=0=ZDALNY, ZL=1=LOKALNY');
});