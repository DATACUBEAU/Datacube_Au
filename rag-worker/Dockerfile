FROM node:20-slim

WORKDIR /app

# Install system dependencies if needed (e.g. for canvas or other native modules)
# RUN apt-get update && apt-get install -y ...

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Model cache locations (persist via docker-compose volumes)
ENV FASTEMBED_CACHE_DIR=/app/local_cache/fastembed
ENV HF_CACHE_DIR=/app/local_cache/hf
ENV TRANSFORMERS_EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2
RUN mkdir -p /app/local_cache/fastembed /app/local_cache/hf

CMD ["npm", "start"]
