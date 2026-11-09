FROM node:20-slim

WORKDIR /app

# Install OpenSSL for Prisma query engine compatibility on Debian slim
RUN apt-get update -y && apt-get install -y openssl

COPY package*.json ./
RUN npm install

COPY . .

# ARG only exists during build — it does NOT persist to runtime.
# This lets prisma generate succeed without a live DB connection.
ARG DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN DATABASE_URL=${DATABASE_URL} npx prisma generate

EXPOSE 8080

CMD ["sh", "-c", "npx prisma migrate deploy && node index.js"]
