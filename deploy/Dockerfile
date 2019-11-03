FROM node:10

RUN mkdir app

# Create app directory
WORKDIR /app

COPY package*.json ./

RUN npm install

RUN npm install -g ts-node
RUN npm install -g typescript

COPY . .

EXPOSE 8080

RUN npm run build
CMD [ "npm", "run", "run" ]

