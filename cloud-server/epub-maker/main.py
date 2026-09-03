import os
import shutil
import subprocess
import tempfile
import uuid

from flask import Flask, request, send_file, jsonify

app = Flask(__name__)
SCRIPT = os.environ.get('EPUB_MAKER_SCRIPT', '/app/cn_epub_maker.py')


@app.route('/health', methods=['GET'])
def health():
    return jsonify({'ok': True})


@app.route('/convert', methods=['POST'])
def convert():
    title = request.form.get('title', '').strip()
    author = request.form.get('author', '').strip()
    if not title or not author:
        return jsonify({'error': '书名和作者必填'}), 400

    txt = request.files.get('txt')
    if not txt:
        return jsonify({'error': '缺少 TXT 文件'}), 400

    tmp = tempfile.mkdtemp()
    try:
        txt_path = os.path.join(tmp, 'input.txt')
        txt.save(txt_path)

        cover_path = None
        cover = request.files.get('cover')
        if cover and cover.filename:
            ext = os.path.splitext(cover.filename)[1].lower()
            if ext not in ('.png', '.jpg', '.jpeg', '.webp'):
                return jsonify({'error': '封面仅支持 PNG、JPG、WebP'}), 400
            cover_path = os.path.join(tmp, 'cover' + ext)
            cover.save(cover_path)

        out_path = os.path.join(tmp, str(uuid.uuid4()) + '.epub')

        cmd = ['python3', SCRIPT, txt_path, '-t', title, '-a', author, '-o', out_path]
        if cover_path:
            cmd += ['--cover', cover_path]
        if request.form.get('horizontal') == 'true':
            cmd += ['--horizontal']
        if request.form.get('no_convert') == 'true':
            cmd += ['--no-convert']
        if request.form.get('no_renumber') == 'true':
            cmd += ['--no-renumber']
        if request.form.get('keep_arabic') == 'true':
            cmd += ['--keep-arabic']
        if request.form.get('keep_quotes') == 'true':
            cmd += ['--keep-quotes']

        subprocess.run(cmd, check=True, timeout=600)
        if not os.path.isfile(out_path):
            return jsonify({'error': '转换失败，未生成 EPUB'}), 500

        safe = title.replace('/', '-').replace('\\', '-')[:80]
        return send_file(out_path, as_attachment=True, download_name=f'{safe}.epub')
    except subprocess.CalledProcessError as e:
        return jsonify({'error': f'转换失败: {e}'}), 500
    except subprocess.TimeoutExpired:
        return jsonify({'error': '转换超时，请稍后再试'}), 504
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8080'))
    app.run(host='0.0.0.0', port=port, threaded=True)
