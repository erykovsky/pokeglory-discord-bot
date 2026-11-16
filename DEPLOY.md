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

## Konkursy zamiast /daily

1. W grze zastosuj kompatybilną migrację tabeli `discord_contests` lub `db:push`
   i wdroż endpoint `/api/discord/contests` przed przełączeniem bota.
2. W konfiguracji **gry** ustaw `DISCORD_CONTEST_REWARDS` jako obiekt JSON.
   Klucze to `daily`, `weekly`, `monthly` i `numbers`. Wartość to
   `{"currency":"yen","amount":50000}` albo `{"currency":"pz","amount":10}`.
   To przykładowe wartości do ustalenia przez administrację. Brak nagrody w konfiguracji
   oznacza, że bot nie otworzy danego losowania. Turniej pojedynków przyznaje
   po 10 XP obojgu graczom za rozegrany pojedynek, a zgadywanie Pokémona przyznaje 15 XP.
   Każdy gracz otrzymuje jednego Pokémona na cały turniej. Rzadkość jest losowana
   przed gatunkiem. Każdy stopień różnicy daje rzadszemu Pokémonowi 5 punktów
   procentowych przewagi od bazowych 50%, maksymalnie do 75%.
3. Przygotuj osobną kategorię Discord dla konkursów poza
   `POKEGLORY_PROTECTED_CATEGORY_IDS`, żeby synchronizacja uprawnień dostępu do gry
   nie nadpisywała blokad poziomu. W kanałach o wymaganym poziomie
   odbierz `View Channel` roli `@everyone` i przyznaj go odpowiedniej roli poziomu.
   Daj botowi dostęp do kanałów, wysyłania embedów i załączników oraz do zarządzania
   rolami poziomu. Role poziomu umieść poniżej roli bota.
4. W konfiguracji **bota** ustaw `POKEGLORY_GUILD_ID`, istniejący sekret i
   `POKEGLORY_CONTESTS`. Obiekt zawiera pola:
   - `channels` z ID kanałów dla wybranych rodzajów. Dostępne klucze to `daily`,
     `weekly`, `monthly`, `games`, `numbers` i `pokemon`. Pominięcie klucza
     wyłącza dany rodzaj. Losowanie dzienne wymaga również ustawienia
     `games`. Oba mogą korzystać z tego samego kanału. Zgadywanki potrzebują osobnych kanałów.
   - `levelRoles` z parami poziom i ID roli. Przykładowe poziomy to `2` dla kanału
     tygodniowego i `3` dla miesięcznego. Bot przyznaje role wraz z postępem.
   - `automatic` jako `true` uruchamia do ośmiu turniejów dziennie. Bot losuje godziny
     startu w oknach 07:00–08:00, 08:00–10:00, 10:00–12:00, 12:00–14:00,
     14:00–16:00, 16:00–18:00, 18:00–20:00 i 20:00–21:00 czasu warszawskiego.
     Losowanie dzienne jest jedno i startuje po zakończeniu ostatniego,
     wieczornego turnieju. Zgadywanie Pokémona może zacząć się codziennie, losowanie tygodniowe
     w niedzielę, a miesięczne ostatniego dnia miesiąca. Administrator może
     uruchomić dowolny aktywny rodzaj komendą `/konkurs`.
5. Gracze używają `/aktywnosc` do podglądu poziomu, XP i statusu pojedynku
   w tym tygodniu. Co najmniej jeden rozegrany pojedynek wystarcza do dziennych
   losowań do najbliższego poniedziałku czasu warszawskiego. Wiadomości na czacie
   nie dają XP. Poprzedni łączny XP pozostaje zapisany.

Zachowaj wolumen `./data:/app/data`, w którym jest plik `contests.json`.
Przechowuje aktywność, zapisy i wynik w trakcie wypłaty. Uruchamiaj jedną
instancję bota zapisującą ten plik. Ponowienie wypłaty z tym samym identyfikatorem
nie powoduje ponownego przyznania nagrody. Przed zmianą ID kanału pozostaw
botowi dostęp do poprzedniego do końca otwartego konkursu.
