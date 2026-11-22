// The label vocabulary for everyday photo content: [German, English twin]. The German word is what the user sees and
// searches for. The text that gets embedded is the English twin in a photo prompt (labelPrompt). Measured with CLIP it
// ranked the right label far higher than the German word; with SigLIP 2 German and English prompts are about even
// (each misses 3 or 4 of 35 judged photos, docs/ml.md), so the prompt stayed as it was.
export type Label = { de: string; en: string };

const RAW: [string, string][] = [
  // Natur und Landschaft
  ["Strand", "beach"], ["Meer", "sea"], ["Küste", "coast"], ["Insel", "island"], ["See", "lake"], ["Fluss", "river"],
  ["Wasserfall", "waterfall"], ["Berge", "mountains"], ["Gipfel", "mountain summit"], ["Gletscher", "glacier"],
  ["Tal", "valley"], ["Hügel", "hills"], ["Wald", "forest"], ["Wiese", "meadow"], ["Feld", "field"], ["Wüste", "desert"],
  ["Höhle", "cave"], ["Klippen", "cliffs"], ["Dünen", "sand dunes"], ["Schnee", "snow"], ["Eis", "ice"], ["Regen", "rain"],
  ["Nebel", "fog"], ["Gewitter", "thunderstorm"], ["Regenbogen", "rainbow"], ["Wolken", "clouds"], ["Himmel", "sky"],
  ["Sonnenuntergang", "sunset"], ["Sonnenaufgang", "sunrise"], ["Sterne", "stars"], ["Nachthimmel", "night sky"],
  ["Mond", "moon"], ["Herbstlaub", "autumn leaves"], ["Blumen", "flowers"], ["Rosen", "roses"], ["Tulpen", "tulips"],
  ["Sonnenblumen", "sunflowers"], ["Kirschblüten", "cherry blossoms"], ["Baum", "tree"], ["Palmen", "palm trees"],
  ["Pilze", "mushrooms"], ["Garten", "garden"], ["Park", "park"], ["Landschaft", "landscape"], ["Panorama", "panorama"],
  // Tiere
  ["Hund", "dog"], ["Welpe", "puppy"], ["Katze", "cat"], ["Kätzchen", "kitten"], ["Pferd", "horse"], ["Kuh", "cow"],
  ["Schaf", "sheep"], ["Ziege", "goat"], ["Schwein", "pig"], ["Hase", "rabbit"], ["Hamster", "hamster"], ["Vogel", "bird"],
  ["Ente", "duck"], ["Schwan", "swan"], ["Eule", "owl"], ["Adler", "eagle"], ["Papagei", "parrot"], ["Fisch", "fish"],
  ["Delfin", "dolphin"], ["Wal", "whale"], ["Hai", "shark"], ["Schildkröte", "turtle"], ["Frosch", "frog"],
  ["Schlange", "snake"], ["Eidechse", "lizard"], ["Schmetterling", "butterfly"], ["Biene", "bee"], ["Käfer", "beetle"],
  ["Spinne", "spider"], ["Schnecke", "snail"], ["Eichhörnchen", "squirrel"], ["Fuchs", "fox"], ["Reh", "deer"],
  ["Bär", "bear"], ["Elefant", "elephant"], ["Giraffe", "giraffe"], ["Löwe", "lion"], ["Affe", "monkey"], ["Pinguin", "penguin"],
  ["Zoo", "zoo"], ["Aquarium", "aquarium"], ["Bauernhof", "farm"],
  // Menschen und Anlässe
  ["Baby", "baby"], ["Kind", "child"], ["Kinder spielen", "children playing"], ["Teenager", "teenager"], ["Frau", "woman"],
  ["Mann", "man"], ["Senioren", "elderly people"], ["Familie", "family"], ["Paar", "couple"], ["Freunde", "friends"],
  ["Selfie", "selfie"], ["Porträt", "portrait"], ["Gruppenfoto", "group photo"], ["Menschen", "people"], ["Menschenmenge", "crowd"],
  ["Geburtstag", "birthday"], ["Geburtstagstorte", "birthday cake"], ["Hochzeit", "wedding"], ["Brautpaar", "bride and groom"],
  ["Taufe", "baptism"], ["Weihnachten", "christmas"], ["Weihnachtsbaum", "christmas tree"], ["Ostern", "easter"],
  ["Silvester", "new year's eve"], ["Feuerwerk", "fireworks"], ["Halloween", "halloween"], ["Karneval", "carnival"],
  ["Party", "party"], ["Konzert", "concert"], ["Festival", "music festival"], ["Tanzen", "dancing"], ["Abschlussfeier", "graduation"],
  ["Grillen", "barbecue"], ["Picknick", "picnic"], ["Lagerfeuer", "campfire"], ["Urlaub", "vacation"], ["Reise", "travel"],
  // Essen und Trinken
  ["Essen", "food"], ["Frühstück", "breakfast"], ["Mittagessen", "lunch"], ["Abendessen", "dinner"], ["Restaurant", "restaurant"],
  ["Kuchen", "cake"], ["Torte", "layer cake"], ["Kekse", "cookies"], ["Eis essen", "ice cream"], ["Schokolade", "chocolate"],
  ["Pizza", "pizza"], ["Pasta", "pasta"], ["Burger", "burger"], ["Sushi", "sushi"], ["Salat", "salad"], ["Suppe", "soup"],
  ["Brot", "bread"], ["Brezel", "pretzel"], ["Käse", "cheese"], ["Obst", "fruit"], ["Gemüse", "vegetables"], ["Beeren", "berries"],
  ["Kaffee", "coffee"], ["Tee", "tea"], ["Bier", "beer"], ["Wein", "wine"], ["Cocktail", "cocktail"], ["Getränke", "drinks"],
  ["Kochen", "cooking"], ["Backen", "baking"], ["Marktstand", "market stall"], ["Speisekarte", "menu"],
  // Orte und Gebäude
  ["Stadt", "city"], ["Stadt bei Nacht", "city at night"], ["Skyline", "skyline"], ["Straße", "street"], ["Gasse", "alley"],
  ["Marktplatz", "town square"], ["Dorf", "village"], ["Haus", "house"], ["Wohnung", "apartment"], ["Küche", "kitchen"],
  ["Wohnzimmer", "living room"], ["Schlafzimmer", "bedroom"], ["Badezimmer", "bathroom"], ["Balkon", "balcony"],
  ["Kirche", "church"], ["Dom", "cathedral"], ["Moschee", "mosque"], ["Tempel", "temple"], ["Schloss", "castle"],
  ["Burg", "fortress"], ["Ruine", "ruins"], ["Turm", "tower"], ["Brücke", "bridge"], ["Museum", "museum"], ["Galerie", "art gallery"],
  ["Bibliothek", "library"], ["Schule", "school"], ["Universität", "university"], ["Büro", "office"], ["Krankenhaus", "hospital"],
  ["Bahnhof", "train station"], ["Flughafen", "airport"], ["Hafen", "harbor"], ["Supermarkt", "supermarket"],
  ["Einkaufsstraße", "shopping street"], ["Spielplatz", "playground"], ["Stadion", "stadium"], ["Schwimmbad", "swimming pool"],
  ["Hotel", "hotel"], ["Zelt", "tent"], ["Campingplatz", "campsite"], ["Skihütte", "ski lodge"], ["Denkmal", "monument"],
  ["Brunnen", "fountain"], ["Friedhof", "cemetery"], ["Graffiti", "graffiti"], ["Straßenschild", "street sign"],
  // Fahrzeuge
  ["Auto", "car"], ["Oldtimer", "vintage car"], ["Motorrad", "motorcycle"], ["Fahrrad", "bicycle"], ["Roller", "scooter"],
  ["Bus", "bus"], ["Straßenbahn", "tram"], ["Zug", "train"], ["U-Bahn", "subway"], ["Flugzeug", "airplane"],
  ["Hubschrauber", "helicopter"], ["Schiff", "ship"], ["Boot", "boat"], ["Segelboot", "sailboat"], ["Fähre", "ferry"],
  ["Lastwagen", "truck"], ["Traktor", "tractor"], ["Wohnmobil", "camper van"], ["Stau", "traffic jam"],
  // Sport und Freizeit
  ["Wandern", "hiking"], ["Radfahren", "cycling"], ["Laufen", "running"], ["Schwimmen", "swimming"], ["Skifahren", "skiing"],
  ["Snowboarden", "snowboarding"], ["Klettern", "climbing"], ["Surfen", "surfing"], ["Segeln", "sailing"], ["Angeln", "fishing"],
  ["Fußball", "soccer"], ["Basketball", "basketball"], ["Tennis", "tennis"], ["Yoga", "yoga"], ["Fitnessstudio", "gym"],
  ["Schlittschuhlaufen", "ice skating"], ["Schlitten", "sledding"], ["Schneemann", "snowman"], ["Reiten", "horse riding"],
  ["Spielen", "playing games"], ["Brettspiel", "board game"], ["Musikinstrument", "musical instrument"], ["Gitarre", "guitar"],
  ["Klavier", "piano"], ["Malen", "painting a picture"], ["Basteln", "crafts"],
  // Dokumente, Bildschirme, Alltag
  ["Screenshot", "screenshot"], ["Bildschirmfoto einer App", "screenshot of an app"], ["Chat", "chat conversation"],
  ["Dokument", "document"], ["Quittung", "receipt"], ["Rechnung", "invoice"], ["Fahrkarte", "ticket"], ["Formular", "form"],
  ["Brief", "letter"], ["Visitenkarte", "business card"], ["Plakat", "poster"], ["Whiteboard", "whiteboard"],
  ["Notizen", "handwritten notes"], ["Text", "text"], ["Tabelle", "spreadsheet"], ["Diagramm", "chart"], ["Karte", "map"],
  ["Zeitung", "newspaper"], ["Buch", "book"], ["Buchseite", "book page"], ["Meme", "meme"], ["Zeichnung", "drawing"],
  ["Gemälde", "painting"], ["Illustration", "illustration"], ["Comic", "comic"], ["Skulptur", "sculpture"], ["Kunst", "art"],
  ["Computer", "computer"], ["Laptop", "laptop"], ["Smartphone", "smartphone"], ["Fernseher", "television"],
  ["Videospiel", "video game"], ["Kamera", "camera"], ["Schreibtisch", "desk"], ["Werkzeug", "tools"], ["Baustelle", "construction site"],
  ["Elektronik", "electronics"], ["Platine", "circuit board"], ["Möbel", "furniture"], ["Kleidung", "clothes"], ["Schuhe", "shoes"],
  ["Schmuck", "jewelry"], ["Spielzeug", "toy"], ["Geschenk", "gift"], ["Verpackung", "packaging"], ["Pflanzen im Zimmer", "houseplants"],
  ["Kerzen", "candles"], ["Spiegelbild", "reflection"], ["Schatten", "shadows"], ["Detailaufnahme", "close-up"],
  ["Makroaufnahme", "macro photo"], ["Schwarzweißfoto", "black and white photo"], ["Luftaufnahme", "aerial view"],
  ["Unscharf", "blurry photo"], ["Dunkel", "dark photo"], ["Gegenlicht", "backlight"], ["Nachtaufnahme", "night photo"],
];

export const LABELS: Label[] = RAW.map(([de, en]) => ({ de, en }));

/** The text embedded for a label: "a photo of <english twin>". */
export const labelPrompt = (l: Label) => `a photo of ${l.en}`;
