FROM node:18-alpine

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY . .

# Remove .env file so container uses docker-compose environment variables
RUN rm -f .env

EXPOSE 3000

CMD ["npm", "start"]