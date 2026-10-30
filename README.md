# Bücherkarte

Eine Weltkarte der Bücher – wie Google Maps, nur für Literatur.

- **Kontinente sind Genres** (Drachenland = Fantasy, Sternenarchipel = Science-Fiction, Nebelinseln = Krimi …)
- **Regionen sind Subgenres** (Hochland der Epen, Nordic-Noir-Fjord, Existenzialistenhöhlen …)
- **Orte sind Bücher** – 192 echte Titel, auf der Karte gruppiert nach Nachbarschaft.
- **Straßen** verbinden benachbarte Bücher, **Fährlinien** (gestrichelt) verbinden thematisch
  verwandte Bücher über Genregrenzen hinweg.

## Funktionen

| | |
|---|---|
| Suche | Titel, Autor·in, Kontinent, Region oder Thema (z. B. „magie“), mit Tastaturnavigation; <kbd>/</kbd> fokussiert die Suche |
| Ortskarte | Cover, Lage, Themen, „Ähnliche Bücher“, „In der Nähe“ (in Lese-km), „Mehr von …“ |
| Routenplaner | Lese-Route von Buch A nach Buch B (Dijkstra über Straßen & Fähren); jede Etappe sagt, warum sie passt |
| Themen-Ebene | Klick auf ein Thema hebt alle Bücher dazu weltweit hervor |
| Merkliste | Bücher merken (lokal im Browser gespeichert), markiert auf der Karte |
| Teilen | Direktlinks wie `index.html#buch-piranesi` |
| Karte | Ziehen, Mausrad/Pinch-Zoom, Doppelklick, Pfeiltasten, Maßstab, Hell-/Dunkelmodus, Handy-Ansicht |
| Online-Extras | Wenn erreichbar, lädt die Ortskarte Cover, Seitenzahl und Bewertung von Open Library |

## Starten

Keine Abhängigkeiten, kein Build. Einfach `index.html` im Browser öffnen oder lokal ausliefern:

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen. Läuft auch direkt auf GitHub Pages.

## Bücher hinzufügen

Alle Daten stehen in [`data.js`](data.js). Ein Buch ist eine Zeile:

```js
['Der Hobbit', 'J. R. R. Tolkien', 1937, 'reise abenteuer drachen humor'],
```

Position, Küstenlinie, Straßen und Fährlinien werden beim Laden automatisch berechnet.
Gemeinsame Themen-Tags erzeugen Fährlinien zwischen Kontinenten und machen Routen-Etappen kürzer.

## Dateien

- `index.html` – Grundgerüst der Oberfläche
- `style.css` – Gestaltung (Farb-Tokens für Hell/Dunkel)
- `data.js` – Kontinente, Regionen, Bücher, Meeresnamen
- `app.js` – Weltgenerierung, Canvas-Rendering, Interaktion, Suche, Routenplaner
