async function uploadBook(title, author, desc, file) {
  const form = new FormData();
  form.append('title', title);
  form.append('author', author || '');
  form.append('description', desc || '');
  if (file) form.append('cover', file); // campo 'cover' do multer

  const res = await fetch('http://localhost:4000/api/books', {
    method: 'POST',
    body: form
  });
  if (!res.ok) throw new Error('Erro ao publicar');
  return res.json();
}
async function fetchBooks() {
  const res = await fetch('http://localhost:4000/api/books');
  return res.json();
}
async function requestLoan(bookId, requesterName, message) {
  const res = await fetch(`http://localhost:4000/api/books/${bookId}/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requester_name: requesterName, message })
  });
  return res.json();
}
