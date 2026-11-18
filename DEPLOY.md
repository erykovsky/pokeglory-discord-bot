# Deploy na VPS

Bot działa jako osobny kontener Docker Compose.

## Pierwsze uruchomienie

```bash
cd /var/www
git clone https://github.com/erykovsky/pokeglory-discord-bot.git pokeglory-discord-bot
cd /var/www/pokeglory-discord-bot
cp .env.example .env
nano .env
docker compose up -d --build
docker compose logs -f bot
```

## Aktualizacja po zmianach

```bash
cd /var/www/pokeglory-discord-bot
git pull
docker compose up -d --build
docker compose logs -f bot
```

## Ważne

Token Discorda trzymaj tylko w pliku `.env` na VPS-ie. Nie commituj `.env` do repo.
Do parowania kont ustaw też `POKEGLORY_DISCORD_BOT_SECRET` w `.env` bota oraz tę samą wartość jako `DISCORD_BOT_SECRET` w `.env.production` aplikacji PokeGlory.
Mirror czatu gry domyślnie szuka kanału `💬｜chat-w-grze`; można go też wskazać konkretnie przez `POKEGLORY_GAME_CHAT_CHANNEL_ID`.
Mirror aktualizacji gry domyślnie szuka kanału `📢｜aktualizacje`; można go też wskazać konkretnie przez `POKEGLORY_UPDATES_CHANNEL_ID`.

## Kolekcja, pojedynki i losowanie

Ustaw kanał konkursów, pojedynków i kolekcji w konfiguracji bota. Przykład:

```dotenv
POKEGLORY_CONTESTS={"channels":{"daily":"KONKURSY_ID"},"duelChannel":"POJEDYNKI_ID","collectionChannel":"KOLEKCJA_ID","automatic":true}
```

Zostaw istniejący sekret integracji oraz wolumen `./data:/app/data` ze stanem
`contests.json`. Jedna instancja bota zapisuje w nim historię pojedynków,
uczestnictwo, karty, limity i otwarte wymiany. Przed podmianą zrób kopię pliku.
Kolekcja potrzebuje uprawnień do czytania kanału, wysyłania wiadomości i embedów.
Bez `collectionChannel` komenda `/losuj` dalej losuje liczbę.

1. Ustaw rotację od poniedziałku do niedzieli w konfiguracji **gry** i wdróż
   aplikację PokeGlory obsługującą zestawy w `/api/discord/contests`. Aktualizacja
   korzysta z istniejącej tabeli `discord_contests`. Do czasu aktualizacji bota
   starszy klient nadal otrzymuje 250 000 ¥ za dzienne losowanie.
2. Wdrażając bota, ustaw ID kanału tekstowego `#kolekcja`. Usuń klucz
   `games` z `channels`, jeśli turnieje mają zniknąć także z komendy administracji.
   Automatyczny harmonogram nie uruchamia turniejów.

```dotenv
DISCORD_CONTEST_REWARDS={"daily":["adventure","hunter","training","adventure","hunter","training","shiny"]}
```

Codziennie o 20:30 czasu warszawskiego bot losuje jednego zweryfikowanego gracza
spośród uczestników `/dolacz`, wypłaca nagrodę do gry i ogłasza wynik.
Udział jest trwały do wpisania `/opusc`. Bot nie otwiera zapisów ani nie wymaga
XP, wygranej lub obecności na kanale. W razie krótkiego przestoju może nadrobić
losowanie po uruchomieniu tego samego dnia. Administrator może rozliczyć je
ręcznie poleceniem `/konkurs` najwyżej raz danego dnia. Kanały dodatkowych
konkursów można nadal skonfigurować oddzielnie.

`/dolacz` zgadza się również na udział w pojedynkach. Na `#pojedynki`
`/pojedynek` od razu losuje dostępnego gracza z puli. Opcja `gracz`
pozwala wybrać kogoś po nicku. Obaj uczestnicy muszą być w puli i mieć kartę.
Bot losuje po jednym gatunku lub formie z aktualnej kolekcji każdego gracza.
Duplikaty nie zwiększają szans w losowaniu karty do walki. Wynik pokazuje
grafiki obu Pokémonów. Karty zostają u właścicieli także po porażce.
Przy ręcznym turnieju bot wybiera po jednej karcie z kolekcji na cały turniej.
Godzinna przerwa po walce i bilans są zachowane. Bot usuwa przyciski starych
wyzwań z ostatnich 100 wiadomości kanału oraz po kliknięciu w starszy przycisk.

Na `#kolekcja` polecenie `/losuj` wyświetla jedną z 224 kart. Każdy gracz ma
trzy losowania w ostatnich czterech godzinach i jedno złapanie na godzinę.
Autor ma 10 sekund pierwszeństwa, a karta jest dostępna przez 90 sekund.
Grafiki pochodzą z istniejących zasobów Pokémonów PokeGlory.
`/kolekcja` pokazuje własny zbiór, liczby egzemplarzy i limity.
Opcja `pokemon` otwiera podgląd karty. Ustaw `publicznie: Tak`, aby pokazać
własną kolekcję lub kartę na kanale.
`/zyczenia` zarządza listą życzeń,
a `/wymiana` proponuje wymianę jednej karty za jedną.
Wymiana trwa 10 minut i wymaga potwierdzenia tylko przez zaproszoną osobę.
Bot usuwa przyciski po złapaniu, wymianie albo upływie czasu.
