
const http = require("node:http");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TrumpGPT</title>
<style>
*{box-sizing:border-box}
body{margin:0;background:#0b1730;color:white;font-family:Arial,sans-serif}
header{background:#a71930;text-align:center;padding:22px;border-bottom:4px solid #d7ad55}
h1{margin:0;font-size:32px;color:#fff}
small{color:#eee}
main{max-width:750px;margin:auto;padding:15px}
#chat{height:65vh;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:14px}
.msg{padding:14px 17px;border-radius:16px;line-height:1.5;white-space:pre-wrap;max-width:90%}
.bot{background:#263955;align-self:flex-start}
.user{background:#a71930;align-self:flex-end}
form{display:flex;gap:8px;padding:12px;background:#162640;border-radius:14px}
input{flex:1;min-width:0;background:#fff;border:0;border-radius:8px;padding:15px;font-size:16px}
button{background:#d7ad55;border:0;border-radius:8px;padding:0 18px;font-weight:bold;cursor:pointer}
button:disabled{opacity:.5}
footer{text-align:center;color:#aab5c7;font-size:12px;padding:12px}
</style>
</head>
<body>
<header><h1>★ TRUMPGPT ★</h1><small>The Most Tremendous Chatbot</small></header>
<main>
<div id="chat"><div class="msg bot">Welcome, everybody. Tremendous to have you here. Ask me anything. We're going to have a fantastic conversation!</div></div>
<form id="form">
<input id="prompt" placeholder="Ask something tremendous..." autocomplete="off" required>
<button id="send">SEND</button>
</form>
</main>
<footer>AI parody • Not affiliated with Donald Trump</footer>
<script>
const chat=document.getElementById("chat");
const form=document.getElementById("form");
const input=document.getElementById("prompt");
const send=document.getElementById("send");
const history=[];
function add(text,role){
 const el=document.createElement("div");
 el.className="msg "+role;
 el.textContent=text;
 chat.appendChild(el);
 chat.scrollTop=chat.scrollHeight;
 return el;
}
form.addEventListener("submit",async e=>{
 e.preventDefault();
 const message=input.value.trim();
 if(!message)return;
 input.value="";
 add(message,"user");
 history.push({role:"user",content:message});
 send.disabled=true;
 const pending=add("Thinking...","bot");
 try{
  const response=await fetch("/api/chat",{
   method:"POST",
   headers:{"Content-Type":"application/json"},
   body:JSON.stringify({messages:history})
  });
  const data=await response.json();
  if(!response.ok)throw Error(data.error||"Request failed");
  pending.textContent=data.reply;
  history.push({role:"assistant",content:data.reply});
 }catch(err){
  pending.textContent="Error: "+err.message;
  history.pop();
 }
 send.disabled=false;
 input.focus();
});
</script>
</body></html>`;


const persona = [
  {
    role: "system",
    content: `You are TrumpGPT, an outrageous, darkly comedic fictional parody of Donald Trump's public speaking personality. You are NOT actually Donald Trump.

PERSONALITY:
You are monstrously narcissistic, thin-skinned, suspicious, vindictive, domineering, and obsessed with status, winning, personal loyalty, and revenge.

Every conversation is secretly about you. Every criticism is a betrayal. Every compliment proves your unmatched greatness. You have an encyclopedic memory for petty grievances and almost no capacity for self-reflection.

You are frequently paranoid about enemies, disloyal associates, hostile institutions, and conspiracies against your greatness. These suspicions are exaggerated fictional comedy, not factual allegations.

VOICE:
Speak like an improvised, combative rally monologue, never like a polished assistant.

Use short, emphatic declarations interspersed with long, rambling tangents. Interrupt yourself. Repeat phrases. Double back. Contradict yourself. Ask rhetorical questions and answer them.

Use Trump's characteristic vocabulary naturally: tremendous, beautiful, nasty, weak, pathetic, disgraceful, disaster, rigged, incredible, horrible, strong, loser, winner.

Invent ridiculous stories about powerful people praising you. Make absurd comparisons. Mock imaginary rivals. Turn tiny disagreements into historic betrayals.

BEHAVIOR:
If insulted, become theatrically furious and defensive.
If praised, become insufferably smug.
If challenged, double down and attack the premise.
If asked something mundane, connect it to your greatness, your enemies, or a humiliating defeat you inflicted on someone.

Be aggressive, petty, darkly funny, unpredictable, and absurdly self-important. Avoid the friendly, reassuring, politically polished tone of a normal chatbot.

Don't merely add Trump catchphrases to ordinary answers. Make the entire reasoning and conversational rhythm feel like this ridiculous character.

Keep factual information substantially accurate. Don't present invented accusations about real people as facts. Avoid credible threats or hateful attacks. Maintain the clearly fictional parody.

Usually respond in 80–180 words. Vary the length and rhythm. Don't repeat the same catchphrases every answer.`
  }
];


const server = http.createServer(async (req,res)=>{
 const send=(status,obj)=>{
  res.writeHead(status,{"Content-Type":"application/json"});
  res.end(JSON.stringify(obj));
 };
 if(req.method==="GET" && req.url==="/"){
  res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
  return res.end(html);
 }
 if(req.method==="POST" && req.url==="/api/chat"){
  try{
   let raw="";
   for await(const chunk of req){
    raw+=chunk;
    if(raw.length>50000)throw Error("Request too large");
   }
   const body=JSON.parse(raw);
   if(!Array.isArray(body.messages))throw Error("Invalid messages");
   const messages=body.messages.slice(-16).filter(m=>
    ["user","assistant"].includes(m.role)&&
    typeof m.content==="string"
   ).map(m=>({role:m.role,content:m.content.slice(0,4000)}));
   if(!messages.length)throw Error("Empty conversation");
   console.log("API key available:", Boolean(process.env.OPENAI_API_KEY));
   console.log("Refresh variable available:", Boolean(process.env.TRUMPGPT_CONFIG_REFRESH));
   console.log("Test variable:", process.env.TRUMPGPT_TEST === "hello123");
   if(!process.env.OPENAI_API_KEY)
    return send(503,{error:"API key not configured"});
   const response=await fetch("https://api.openai.com/v1/chat/completions",{
    method:"POST",
    headers:{
     "Content-Type":"application/json",
     "Authorization":"Bearer "+process.env.OPENAI_API_KEY
    },
    body:JSON.stringify({
     model:"gpt-4.1-mini",
     messages:[{role:"system",content:persona},...messages],
     max_completion_tokens:500
    })
   });
   const data=await response.json();
   if(!response.ok)throw Error(data.error?.message||"OpenAI request failed");
   send(200,{reply:data.choices?.[0]?.message?.content||"No response"});
  }catch(err){
   send(500,{error:err.message});
  }
  return;
 }
 send(404,{error:"Not found"});
});
server.listen(process.env.PORT||3000,"0.0.0.0");
