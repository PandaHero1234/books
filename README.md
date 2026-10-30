# Bücherkarte

Eine zoombare Bibliothek mit **semantischem Zoom**: 192 Bücher, geordnet in verschachtelten Fächern.
Jede Ebene beschreibt als Text, was dich beim nächsten Hineinzoomen erwartet.

| Ebene | Was du siehst | Was der Text ankündigt |
|---|---|---|
| Genres | 10 Fächer mit Beschreibung, Bücherzahl, Zeitspanne und Cover-Streifen | die Subgenres mit Kurzbeschreibung |
| Subgenres | z. B. „Epische Fantasy“, „Nordic Noir“ | die Themen und welche Bücher darin liegen |
| Themen | automatisch gebildete Gruppen wie „Krieg“, „Reise“, „Psychologie“ | jedes Buch mit Autor·in, Jahr und Kurzinhalt |
| Bücher | Cover-Raster mit Titel und Autor·in | Beschreibung und Themen |
| Details | große Cover mit Kurzinhalt und Themen | – (Klick öffnet die Detailseite) |

## Bedienung

- Mausrad, Pinch oder +/− zoomen weich zum Zeiger; Ziehen verschiebt mit Schwung
- Klick auf ein Fach zoomt genau so weit hinein, dass es sich öffnet
- Der Stufenregler rechts springt direkt zu Genres, Subgenres, Themen, Büchern oder Details
- Der Pfad oben zeigt, wo du bist, und was das Fach in der Mitte enthält
- Suche nach Titel, Autor·in, Genre, Subgenre oder Thema (<kbd>/</kbd> fokussiert die Suche, <kbd>Esc</kbd> zoomt eine Ebene heraus)
- Klick auf ein Thema-Tag blendet alle anderen Bücher ab und zeigt Treffer pro Fach
- Merkliste (lokal im Browser) und Direktlinks wie `index.html#buch-piranesi`

## Cover

Die App lädt Cover in dieser Reihenfolge:

1. lokale Dateien aus `covers/` (siehe unten),
2. zur Laufzeit von [Open Library](https://openlibrary.org) – im Browser mit Internetzugang,
3. sonst ein gestaltetes Typo-Cover in der Genrefarbe.

Um alle Cover einmalig herunterzuladen (danach funktionieren sie offline und überall):

```bash
python3 scripts/fetch_covers.py
```

Das Skript schreibt `covers/*.jpg` und `covers/manifest.js`. Mit installiertem Pillow werden die Bilder auf 240 px verkleinert.

## Starten

Keine Abhängigkeiten, kein Build:

```bash
python3 -m http.server 8000
```

Dann <http://localhost:8000> öffnen. Läuft auch auf GitHub Pages.

## Bücher hinzufügen

Alle Daten stehen in [`data.js`](data.js). Ein Buch ist eine Zeile:

```js
['Der Hobbit', 'J. R. R. Tolkien', 1937, 'reise abenteuer drachen humor', 'Bilbo zieht mit dreizehn Zwergen los, um einen Drachenschatz zurückzuholen.'],
```

Die Themen-Gruppen entstehen automatisch aus den Tags: Innerhalb eines Subgenres wird das häufigste
gemeinsame Thema zur Gruppe, Einzelgänger landen bei „Weitere Bücher“. Layout und Zoomstufen
werden beim Laden berechnet.

## Dateien

- `index.html` – Grundgerüst
- `style.css` – Gestaltung (Farb-Tokens für Hell/Dunkel, Fächer je Ebene)
- `data.js` – Genres, Subgenres, Bücher mit Kurzbeschreibungen
- `app.js` – Treemap-Layout, semantischer Zoom, Cover-Laden, Suche, Detailseite
- `covers/` – optionale lokale Cover, `scripts/fetch_covers.py` lädt sie
