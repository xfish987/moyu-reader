# 国内服务器使用 DaoCloud 镜像加速；海外环境可直接用 python:3.12-slim
FROM docker.m.daocloud.io/python:3.12-slim

# 使用清华源加速 apt，减少在海外 debian 源上的等待
RUN sed -i 's|http://deb.debian.org/debian|https://mirrors.tuna.tsinghua.edu.cn/debian|g; s|http://deb.debian.org/debian-security|https://mirrors.tuna.tsinghua.edu.cn/debian-security|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends pandoc opencc curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 固定版本：cn-epub-maker main 分支当前版本
RUN curl -fsSL -o cn_epub_maker.py \
    https://raw.githubusercontent.com/muyen/cn-epub-maker/main/cn_epub_maker.py

COPY main.py .

ENV PORT=8080 EPUB_MAKER_SCRIPT=/app/cn_epub_maker.py
EXPOSE 8080

CMD ["python", "main.py"]
