const imageSrc = 'static/b.png'; // เส้นทางของภาพ
var click = true
// ฟังก์ชันในการสร้างภาพที่มุมต่างๆ
const corners = [
    'top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'
];

corners.forEach(c => {
    const img = document.createElement('img');
    img.src = imageSrc;
    img.classList.add('image');
    img.classList.add(c)
    document.body.appendChild(img);
})
const overlay = document.querySelector('.overlay');
const input = document.getElementById("input")

document.body.addEventListener("click", function(e) {
    if (click)input.click()
})

input.addEventListener("input", async function() {
    const formData = new FormData()
    for(const file of this.files) {
        formData.append("files", file)
    }
    let totalSize = formData.getAll("files").map(i => i.size).reduce((a, b) => a + b)
    if (totalSize >1000 * 1000 * 1024 * 1024) return alert("Files are too large")
    click = false
    overlay.style.display = 'flex'
    await fetch('/upload', {
        method: 'POST',
        body: formData
    })
    click = true
    overlay.style.display = 'none'
})