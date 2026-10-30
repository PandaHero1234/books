# Bücherkarte

Eine Weltkarte der Bücher – wie Google Maps, nur für Literatur.

- **Kontinente sind Genres** (Drachenland = Fantasy, Sternenarchipel = Science-Fiction, Nebelinseln = Krimi …)
- **Regionen sind Subgenres** (Hochland der Epen, Nordic-Noir-Fjord, Existenzialistenhöhlen …)
- **Themen-Cluster** fassen Bücher einer Region mit gemeinsamem Thema zusammen (Krieg, Reise, Ermittlung …)
- **Orte sind Bücher** – 192 echte Titel.
- **Straßen** verbinden benachbarte Bücher, **Fährlinien** (gestrichelt) verbinden thematisch
  verwandte Bücher über Genregrenzen hinweg.

## Funktionen

| | |
|---|---|
| Cluster-Stufen | Wie bei Google Maps: Zahlenblasen fassen Bücher zusammen (Kontinente → Regionen → Themen → Bücher) und teilen sich beim Hineinzoomen animiert auf; Klick auf eine Blase zoomt hinein |
| Zoom | Weiches Zoomen zum Mauszeiger, Schwung nach dem Ziehen, Doppelklick/Doppeltipp, Pinch, Stufenregler neben den Zoom-Knöpfen |
| Suche | Titel, Autor·in, Kontinent, Region oder Thema (z. B. „magie“), mit Tastaturnavigation; <kbd>/</kbd> fokussiert die Suche |
| Ortskarte | Cover, Lage, Themen, „Ähnliche Bücher“, „In der Nähe“ (in Lese-km), „Mehr von …“ |
| Routenplaner | Lese-Route von Buch A nach Buch B (Dijkstra über Straßen & Fähren); jede Etappe sagt, warum sie passt |
| Themen-Ebene | Klick auf ein Thema hebt alle Bücher dazu weltweit hervor |
| Merkliste | Bücher merken (lokal im Browser gespeichert), markiert auf der Karte |
| Teilen | Direktlinks wie `index.html#buch-piranesi` |
| Karte | Straßen, Hauptstraßen zwischen Regionen, Fährlinien zwischen Genres, Pfeiltasten, Maßstab, Hell-/Dunkelmodus, Handy-Ansicht |
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

Themen-Cluster, Position, Küstenlinie, Straßen, Fährlinien und Zoomstufen werden beim Laden automatisch berechnet.
Gemeinsame Themen-Tags erzeugen Fährlinien zwischen Kontinenten und machen Routen-Etappen kürzer.

## Dateien

- `index.html` – Grundgerüst der Oberfläche
- `style.css` – Gestaltung (Farb-Tokens für Hell/Dunkel)
- `data.js` – Kontinente, Regionen, Bücher, Meeresnamen
- `app.js` – Weltgenerierung, Canvas-Rendering, Interaktion, Suche, Routenplaner
