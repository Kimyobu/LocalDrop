from flask import Flask, request, render_template, jsonify, Request
import os
import platform

def d(path):
    if not os.path.isdir(path):
        os.makedirs(path, exist_ok=True)
        
d("./files")

def save_file(file, filename):
    # ตรวจสอบว่าไฟล์มีอยู่แล้วใน directory หรือไม่
    base_filename, extension = os.path.splitext(filename)
    
    # เช็คว่าไฟล์ที่มีชื่อเดียวกันใน directory นี้มีอยู่แล้วหรือไม่
    count = 0
    new_filename = filename
    while os.path.exists(new_filename):  # ถ้ามีไฟล์ที่ชื่อเดียวกัน
        count += 1
        new_filename = f"{base_filename}{count}{extension}"  # เพิ่มเลขต่อท้ายชื่อไฟล์

    # บันทึกไฟล์
    file.save(new_filename)
    print(f"File saved as {new_filename}")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
app = Flask("main", template_folder=os.path.join(BASE_DIR, "pages"), static_folder=os.path.join(BASE_DIR, "static"))
class MyRequest(Request):
    max_content_length = 1024**5  # 1TB

app.request_class = MyRequest

app.config['MAX_CONTENT_LENGTH'] = 1024**5

@app.get("/")
def root():
    return jsonify(dict(name=platform.node(), os=platform.system()))

@app.get("/main")
def main():
    return render_template("main.html")

@app.post("/upload")
def upload():
    files = request.files.getlist("files")
    for x in files:
        save_file(x, f"./files/{x.filename}")
    return {}, 200
        
print(app.template_folder)
app.run("0.0.0.0", 5000, debug=True)