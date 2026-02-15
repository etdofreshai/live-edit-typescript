FROM node:22

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --include=dev

COPY . .


CMD ["npm", "run", "dev"]
