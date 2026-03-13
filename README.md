# Webserwer PLC - Siemens S7-1200 · Sterowanie Pompą

**Projekt:** Sterowanie pompą przy pomocy stanowiska lokalnego oraz zdalnego  

---

## Opis projektu

Projekt realizuje zdalny panel operatorski dla pompy sterowanej sterownikiem **Siemens S7-1200**. Strona WWW jest hostowana przez wbudowany WebServer S7 z technologią **AWP (Automation Web Programming)** - specjalny komentarz HTML, który przy każdym żądaniu GET podstawia wartości tagów PLC bezpośrednio w treść strony.

Operator może przełączać tryb sterowania między **LOKALNYM** (fizyczne wejścia PLC) i **ZDALNYM** (przeglądarka), uruchamiać/zatrzymywać pompę, regulować obroty suwakiem potencjometru (`%MW40`), obserwować animowaną wizualizację układu oraz śledzić trendy i dziennik zdarzeń.

---

## Struktura plików

Pliki muszą znaleźć się w katalogu zadeklarowanym w TIA Portal jako **HTML directory** (*Web Server -> User-defined pages*):

```
/
├── index.html
├── styles.css
├── jLIB/
│   └── jquery-4.0.0.min.js
└── js/
    └── vars-update.js
```

> Po każdej zmianie plików: usuń stary Web DB w TIA Portal -> **Generate blocks** -> wgraj hardware + software na sterownik.

---

## Konfiguracja sterownika (TIA Portal)

1. **Web Server -> General** - zaznacz *Activate Web server*, odznacz *Permit access only with HTTPS* (konfiguracja laboratoryjna).
2. **Web Server -> User management** - zostaw `Everybody` lub dodaj użytkownika; uprawnienia: `read tags`, `write tags`, `write/open user-defined web pages`.
3. **Web Server -> User-defined pages** - podaj ścieżkę do katalogu z plikami, ustaw `index.html` jako stronę domyślną, kliknij **Generate blocks**.
4. **Web Server -> Entry page** - wybierz `UP1`.
5. Skompiluj i wgraj projekt na sterownik. W przeglądarce wpisz IP sterownika.

---

## Bloki programu PLC

| Blok | Typ | Opis |
|---|---|---|
| `Main [OB1]` | OB | Pętla główna - odczyt enkodera, pomiary, wywołanie FB trybu sterowania |
| `TrybSterowania [FB1]` | FB | Logika ZL: przełączanie lokalny/zdalny, routing sygnałów start/stop/zwiększ/zmniejsz |
| `Cyclic interrupt [OB30]` | OB | Obsługa potencjometru - cykliczne ±200 na `%MW40` |
| `Startup [OB100]` | OB | Inicjalizacja: `Potencjo = 200` przy starcie CPU |
| `TrybSterowania_DB [DB3]` | DB | Instancja FB1 - tagi wymieniane z WebServerem |
| `RejestrPomiaru [DB1]` | DB | Tablica 11 próbek `per liter` |

---

## Logika sterowania - bit ZL

| Wartość ZL | Tryb | Źródło sygnałów |
|---|---|---|
| `1` | LOKALNY | Wejścia fizyczne PLC (`I0.0`, `I0.6`, `I0.7`) |
| `0` | ZDALNY | Sygnały WWW (`startHMI`, `zwiekszHMI`, `zmniejszHMI`) |

### Typy sygnałów wysyłanych z przeglądarki

| Sygnał | Typ | Zachowanie JS |
|---|---|---|
| `startHMI` | Poziomowy | JS wysyła bieżący stan (`0` lub `1`) przy **każdym pollingu** w trybie zdalnym - PLC wymaga ciągłego sygnału. |
| `zwiekszHMI` / `zmniejszHMI` | Impulsowy | JS wysyła `1`, po odpowiedzi PLC wysyła `0` - symulacja zbocza narastającego. |
| `Potencjo` (`%MW40`) | Wartość | Wysyłany jednorazowo po kliknięciu "ZAPISZ DO PLC". Zakres 0–27600, krok 200. |
| `zaklocenie01` | Kasowanie | Wysyłany jako `0` - reset zakłócenia. |

---

## Zmienne PLC

| Nazwa | Typ | Adres | Opis |
|---|---|---|---|
| `StartPLC` | Bool | `%I0.0` | Fizyczny przycisk START |
| `ZwiekszPLC` | Bool | `%I0.6` | Fizyczny przycisk ZWIĘKSZ |
| `ZmniejszPLC` | Bool | `%I0.7` | Fizyczny przycisk ZMNIEJSZ |
| `zaklocenie01` | Bool | `%I0.3` | Wejście sygnału zakłócenia |
| `Potencjo` | Int | `%MW40` | Wartość potencjometru cyfrowego (0–27600) |
| `StanPotencjometru` | Word | `%QW80` | Wyjście analogowe potencjometru |
| `ManualPotencjometr` | Word | `%IW64` | Odczyt fizycznego potencjometru |
| `Sprzeg` | Bool | `%M1.0` | Sprzężenie - pompa pracuje |
| `ObrotyEnkodera` | DWord | `%ID1000` | Odczyt surowy enkodera |
| `ObrotyReal` | Real | `%MD2020` | Obroty jako wartość rzeczywista |
| `ObrotySuma` | UDInt | `%MD2012` | Suma obrotów od startu |
| `Poziom` | Real | `%MD4` | Znormalizowany poziom z potencjometru (0.0–1.0) |
| `per min` | Real | `%MD1004` | Obroty na minutę (`ObrotyReal / 185.0`) |
| `per liter` | Real | `%MD1008` | Litry na obrót (`ObrotyReal / 250.0`) |
| `buforzaklocen` | Int | `%MW220` | Bufor zakłóceń |
| `zaklocenie22001` | Bool | `%M221.1` | Pamięć zakłócenia |

---

## Architektura JS (`vars-update.js`)

Komunikacja z PLC odbywa się przez **AJAX GET** - dane są odświeżane w tle, bez przeładowania strony.

```
Przeglądarka                       PLC (WebServer S7)
    │--- GET /index.html?tag=val  -->│  (zapis tagu)
    │<-- HTML z podstawionymi AWP ---│  (odczyt wszystkich tagów naraz)
    │
    │  parse(html)  ->  apply(parsed)  ->  aktualizacja DOM + wizualizacja
```

Kluczowe funkcje:

| Funkcja | Opis |
|---|---|
| `poll()` | GET co 3000 ms. W trybie zdalnym dołącza `startHMI_state` do każdego żądania. |
| `parse(html)` | Wyciąga pary klucz/wartość z ukrytych `<div>`-ów w formacie AWP (`:=val:`). |
| `apply(parsed)` | Aktualizuje DOM tylko przy zmianie wartości, wywołuje efekty boczne, wykres, wizualizację SVG. |
| `sideEffect(name, val)` | Reaguje na zmiany: `sprzeg` (animacja wirnika), `zl` (sync trybu), `zaklocenie01` (alarm), `potencjo` (slider). |
| `window.setMode(remote)` | Przełącza tryb. Wysyła `ZL=0/1` do PLC. Przy przejściu w LOKALNY zeruje `startHMI_state`. |
| `window.plcSend(form)` | Serializuje formularz i wysyła GET. Dla tagów impulsowych automatycznie wysyła `0` po `1`. |

Stan trybu (`remoteMode`) i stan startu (`startHMI_state`) są przechowywane w `sessionStorage` - przetrwają odświeżenie strony, ale nie zamknięcie karty.

