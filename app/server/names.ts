// German names for places: exonyms, country names, the German states. No imports, so the parser and the tests can use it.
/** English or GeoNames spelling -> German name. Also used by search.parse so "Munich" finds München. */
export const GERMAN_NAMES: Record<string, string> = {
  Munich: "München", Cologne: "Köln", Vienna: "Wien", Prague: "Prag", Rome: "Rom", Venice: "Venedig", Florence: "Florenz",
  Nuremberg: "Nürnberg", Zurich: "Zürich", Geneva: "Genf", Milan: "Mailand", Naples: "Neapel", Copenhagen: "Kopenhagen",
  Brussels: "Brüssel", Lisbon: "Lissabon", Athens: "Athen", Warsaw: "Warschau", Moscow: "Moskau", Cairo: "Kairo",
  Hanover: "Hannover", Gothenburg: "Göteborg", Krakow: "Krakau", Bucharest: "Bukarest", Belgrade: "Belgrad",
  Turin: "Turin", Genoa: "Genua", Seville: "Sevilla", "Saint Petersburg": "Sankt Petersburg", Luxembourg: "Luxemburg",
  Antwerp: "Antwerpen", "The Hague": "Den Haag", Lucerne: "Luzern", Basel: "Basel", Bern: "Bern", Salzburg: "Salzburg",
  Innsbruck: "Innsbruck", Bruges: "Brügge", Ghent: "Gent", Tallinn: "Tallinn", Gdansk: "Danzig", Wroclaw: "Breslau",
  Szczecin: "Stettin", Poznan: "Posen", Kaliningrad: "Königsberg", Kyiv: "Kiew", Edinburgh: "Edinburgh", Marseille: "Marseille",
  Lyon: "Lyon", Mainz: "Mainz", Brunswick: "Braunschweig", Frankfurt: "Frankfurt am Main", "Frankfurt am Main": "Frankfurt am Main",
  Tunis: "Tunis", Beijing: "Peking", Bangkok: "Bangkok", Mumbai: "Mumbai", "New York City": "New York", Havana: "Havanna",
  Algiers: "Algier", Tangier: "Tanger", Marrakesh: "Marrakesch", Dubrovnik: "Dubrovnik", Zagreb: "Zagreb", Ljubljana: "Laibach",
};
export const COUNTRIES: Record<string, string> = {
  DE: "Deutschland", AT: "Österreich", CH: "Schweiz", IT: "Italien", FR: "Frankreich", ES: "Spanien", PT: "Portugal", GB: "Vereinigtes Königreich",
  IE: "Irland", NL: "Niederlande", BE: "Belgien", LU: "Luxemburg", DK: "Dänemark", SE: "Schweden", NO: "Norwegen", FI: "Finnland", IS: "Island",
  PL: "Polen", CZ: "Tschechien", SK: "Slowakei", HU: "Ungarn", SI: "Slowenien", HR: "Kroatien", RS: "Serbien", BA: "Bosnien und Herzegowina",
  RO: "Rumänien", BG: "Bulgarien", GR: "Griechenland", TR: "Türkei", RU: "Russland", UA: "Ukraine", US: "USA", CA: "Kanada", MX: "Mexiko",
  BR: "Brasilien", AR: "Argentinien", CN: "China", JP: "Japan", IN: "Indien", TH: "Thailand", AU: "Australien", NZ: "Neuseeland", EG: "Ägypten",
  MA: "Marokko", TN: "Tunesien", ZA: "Südafrika", AE: "Vereinigte Arabische Emirate", IL: "Israel", ME: "Montenegro", AL: "Albanien", EE: "Estland", LV: "Lettland", LT: "Litauen", CY: "Zypern", MT: "Malta",
};
export const DE_STATES: Record<string, string> = {
  "01": "Baden-Württemberg", "02": "Bayern", "03": "Bremen", "04": "Hamburg", "05": "Hessen", "06": "Niedersachsen", "07": "Nordrhein-Westfalen",
  "08": "Rheinland-Pfalz", "09": "Saarland", "10": "Schleswig-Holstein", "11": "Brandenburg", "12": "Mecklenburg-Vorpommern", "13": "Sachsen",
  "14": "Sachsen-Anhalt", "15": "Thüringen", "16": "Berlin",
};
export const countryName = (code: string) => COUNTRIES[code] ?? code;
