FROM catdice-trpg:3480b82
WORKDIR /moyu-app
COPY package.json ./
RUN npm install
COPY server.mjs admin.mjs novel.mjs epubCover.mjs epubMaker.mjs ./
COPY web ./web
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
USER node
EXPOSE 8787
CMD ["node", "server.mjs"]
