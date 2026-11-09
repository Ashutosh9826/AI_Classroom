# Stage 1: Build the Vite frontend
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Bake the production API URL into the Vite build
ARG VITE_API_URL=https://academic-atelier-backend-799700337103.us-central1.run.app/api
ENV VITE_API_URL=${VITE_API_URL}

RUN APP_VERSION="$(date -u +%Y%m%d%H%M%S)" \
    && BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    && printf '{"version":"%s","builtAt":"%s"}\n' "$APP_VERSION" "$BUILT_AT" > public/version.json \
    && VITE_APP_VERSION="$APP_VERSION" npm run build

# Stage 2: Serve using Nginx
FROM nginx:alpine

# Copy built assets to Nginx html directory
COPY --from=builder /app/dist /usr/share/nginx/html

# Replace default config to handle SPA routing, keep assets cacheable, and avoid stale app shells.
RUN printf '%s\n' \
    'server {' \
    '    listen 8080;' \
    '    server_name localhost;' \
    '    root /usr/share/nginx/html;' \
    '    index index.html index.htm;' \
    '' \
    '    location = /index.html {' \
    '        try_files /index.html =404;' \
    '        add_header Cache-Control "no-cache, no-store, must-revalidate";' \
    '        add_header Pragma "no-cache";' \
    '        add_header Expires "0";' \
    '    }' \
    '' \
    '    location = /version.json {' \
    '        try_files /version.json =404;' \
    '        add_header Cache-Control "no-cache, no-store, must-revalidate";' \
    '        add_header Pragma "no-cache";' \
    '        add_header Expires "0";' \
    '    }' \
    '' \
    '    location /assets/ {' \
    '        try_files $uri =404;' \
    '        add_header Cache-Control "public, max-age=31536000, immutable";' \
    '    }' \
    '' \
    '    location / {' \
    '        try_files $uri $uri/ /index.html;' \
    '    }' \
    '}' \
    > /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
