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
