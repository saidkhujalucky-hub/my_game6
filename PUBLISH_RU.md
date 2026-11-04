# ПУБЛИКАЦИЯ HERO ISLANDS 12 (версия 2.1)

## Самый простой способ: одна ссылка с полноценным онлайном на Render

1. Распакуй `HERO_ISLANDS_GITHUB_CLOUDFLARE.zip` на компьютере.
2. В GitHub создай **пустой** публичный репозиторий `hero-islands-12`.
3. Нажми **Add file → Upload files** и загрузи **все файлы и папки из распакованной папки**, включая скрытую `.github` и файлы `render.yaml`, `package.json`. Нельзя загружать только ZIP — GitHub не распакует его при обычной загрузке.
4. В Render создай **Blueprint** и подключи репозиторий. `render.yaml` задаст сборку `npm install && npm run build`, команду `npm start` и маршрут проверки `/health`.
5. Дождись завершения сборки. Открой адрес Render в браузере. Один адрес обслуживает и игру, и Socket.IO — вводить переменные не нужно.

> Бесплатный Render может засыпать при отсутствии активности. На бесплатном тарифе и с 12 игроками возможно ухудшение задержки; доступность тарифа проверяй при создании сервиса.

## Вариант: Cloudflare Pages + Render для онлайна

1. Сначала выполни шаги выше — получи действующий адрес Render, например `https://hero-islands-12.onrender.com`.
2. В Cloudflare открой **Workers & Pages → Create → Pages → Connect to Git** (названия пунктов интерфейса могут отличаться).
3. Выбери репозиторий `hero-islands-12`.
4. Настройки сборки: **Framework: Vite** (или None), **Build command: `npm run build`**, **Build output directory: `dist`**, **Root directory: `/`**. Node.js 20+ / 22 при наличии опции.
5. Добавь переменную сборки **`VITE_SOCKET_URL`** со значением `https://ТВОЙ-СЕРВЕР.onrender.com` — точный HTTPS-адрес из Render, без `/socket.io`.
6. Нажми Deploy. После установки или смены переменной запускай новый deploy, чтобы URL попал в собранный JavaScript.

**Почему нужен Render?** Cloudflare Pages обслуживает статические файлы, но исходный сервер игры требует Node.js + Socket.IO. Без отдельного backend на Cloudflare Pages откроется лобби/3D-карта, но кнопка входа в матч не сможет подключиться к онлайну.

## Вариант: GitHub Pages + Render

1. В GitHub репозитории открой **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Настрой переменную репозитория **Settings → Secrets and variables → Actions → Variables → New repository variable**, имя `VITE_SOCKET_URL`, значение `https://ТВОЙ-СЕРВЕР.onrender.com`.
3. Открой **Actions → Deploy HERO ISLANDS to GitHub Pages → Run workflow** (или обнови ветку `main`).
4. Перейди по выданному URL `https://ТВОЙ-ЛОГИН.github.io/hero-islands-12/`.

> В GitHub Actions настроена корректная Vite `base` для имени репозитория, поэтому графика и JS подгружаются по правильному пути.

## Локально

```bash
npm install
npm run dev
```

Открыть `http://localhost:5173`. Проверка: `npm run check` и `npm test`. Полноценный продакшен на одной машине: `npm run build && npm start` → `http://localhost:3001`.

## Когда сайт не работает

- Если Cloudflare/GitHub показывает «Сервер недоступен»: проверь `VITE_SOCKET_URL` и жив ли Render (`https://ТВОЙ-СЕРВЕР.onrender.com/health`).
- Если при первом входе Render долго подключается, сервер может выходить из спящего режима.
- Если ошибка `Failed to fetch` на этапе сборки: проверь доступ хостинга к npm registry.
- Переменная `VITE_SOCKET_URL` — только публичный адрес, **никогда не вставляй туда токены, пароли или ключи API**.
