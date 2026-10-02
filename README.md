# 🦺 CIPA em Jogo — Supermercados Rondon

Quiz gamificado de **Segurança do Trabalho e Prevenção ao Assédio** para os encontros da CIPA.
Os participantes jogam pelo celular. O telão mostra as perguntas, o ranking e o pódio, e o administrador controla tudo pelo painel.

| Página | Para quem | Endereço |
|---|---|---|
| `index.html` | Participantes (celular) | `https://SEU-USUARIO.github.io/cipa-em-jogo/` |
| `telao.html` | Projetor / TV | `…/cipa-em-jogo/telao.html` |
| `admin.html` | Organizador | `…/cipa-em-jogo/admin.html` |

---

## 1. Configurar o Supabase (banco de dados) — ~10 min

1. Entre em <https://supabase.com> → **New project**.
   - Nome: `cipa-em-jogo` · Região: **South America (São Paulo)** · crie uma senha do banco e guarde.
2. Quando o projeto terminar de criar, abra **SQL Editor** → **New query**.
3. Abra o arquivo [`schema.sql`](schema.sql), copie **todo** o conteúdo, cole no editor e clique em **Run**.
   Deve aparecer *"Success. No rows returned"*. As 23 perguntas do quiz já entram prontas, com gabarito e explicações.
4. Vá em **Project Settings → API** (ou **API Keys**) e copie:
   - **Project URL** (ex.: `https://abcdxyz.supabase.co`)
   - a chave pública **anon** / **publishable** (⚠️ nunca use a chave `service_role` / `secret`)
5. Abra [`config.js`](config.js) e cole os dois valores:

```js
export const SUPABASE_URL = 'https://abcdxyz.supabase.co';
export const SUPABASE_KEY = 'eyJhbGciOi...';   // ou sb_publishable_...
```

> A chave pública pode ficar no código: ela só consegue chamar as funções do jogo.
> Toda a regra (pontuação, tempo, gabarito, senha do admin) roda **dentro do banco**, então ninguém consegue trapacear pelo navegador.

---

## 2. Publicar no GitHub Pages — ~5 min

1. Em <https://github.com/new> crie um repositório **público** chamado `cipa-em-jogo`.
2. Envie os arquivos desta pasta:
   - **Pelo site:** clique em *uploading an existing file*, arraste **todo o conteúdo** da pasta `cipa-em-jogo` (são só arquivos, sem subpastas) e clique em *Commit changes*.
   - **Pelo terminal:**

```bash
git init -b main
```

```bash
git add . && git commit -m "CIPA em Jogo"
```

```bash
git remote add origin https://github.com/SEU-USUARIO/cipa-em-jogo.git && git push -u origin main
```

3. No repositório: **Settings → Pages → Build and deployment → Source: Deploy from a branch** → Branch **main** / pasta **/(root)** → **Save**.
4. Em 1 a 2 minutos o jogo fica disponível em `https://SEU-USUARIO.github.io/cipa-em-jogo/`.

---

## 3. Primeiro acesso do administrador

1. Abra `…/admin.html` e entre com a senha inicial **`cipa2026`**.
2. Vá em **⚙️ Configurações**:
   - **Troque a senha** (obrigatório antes do encontro).
   - Cadastre a **lista de lojas/setores** (uma por linha). Assim o ranking das lojas não se divide por erro de digitação.
3. Em **📝 Perguntas** revise o gabarito, o tempo de cada pergunta e as explicações. Também dá para criar, editar, reordenar e duplicar questionários.

**Cadastrar muitas perguntas de uma vez (planilha)**
1. Em **📝 Perguntas**, escolha o questionário e clique em **⬇ Baixar planilha**. Ela já vem com as perguntas atuais (a "base padrão") e uma aba de instruções.
2. No Excel, edite ou acrescente linhas: Categoria, Pergunta, Alternativas A a F (mínimo 2), **Correta (letra)**, Tempo (segundos) e Explicação.
3. Clique em **⬆ Importar planilha** e escolha o arquivo. O sistema confere cada linha e aponta erros (ex.: "Linha 5: informe a letra da resposta correta").
4. Escolha **Adicionar ao final**, **Substituir todas** ou **Criar um novo questionário**.

---

## 4. No dia do encontro

**Checklist (1 dia antes)**
- [ ] Abra o painel do Supabase. **Projetos gratuitos pausam após 7 dias sem uso**, e acessar o painel reativa o projeto.
- [ ] Crie a sessão e faça um teste rápido com 2 celulares.
- [ ] Confira a internet/Wi-Fi do local e a conexão do notebook com o projetor.

**Opções ao criar a sessão**

| Opção | O que faz |
|---|---|
| **Exigir matrícula** | O participante informa a matrícula ao entrar. A mesma matrícula **não consegue responder duas vezes** na sessão, mesmo trocando de nome ou de celular. Se a pessoa trocar de aparelho, basta entrar com o **mesmo nome e matrícula**: ela continua de onde parou. A matrícula aparece no painel, no relatório e no Excel, mas não fica pública. |
| **Avançar automaticamente** | Ao vivo: a resposta fica 10 s no telão, o ranking 6 s e a próxima pergunta entra sozinha. No seu ritmo: depois da explicação (8 s), a próxima pergunta entra sozinha. Dá para ligar/desligar durante o jogo no painel da sessão. |
| **Horário de validade** (no seu ritmo) | Informe **Abre em** e/ou **Encerra em**: a sala abre e fecha sozinha e, fora desse horário, as respostas não são aceitas. O horário pode ser alterado no painel da sessão. |

**Modo 🎤 Ao vivo (estilo Kahoot)**
1. No painel: **Sessões → Nova sessão → Ao vivo → Criar sessão**.
2. Clique em **📺 Abrir telão** e arraste essa aba para o projetor (tecla **F** = tela cheia).
3. Os participantes leem o **QR Code** ou acessam o link e digitam o **PIN** de 6 dígitos.
4. Quando todos entrarem: **▶ Iniciar jogo**.
5. Cada pergunta tem 4 s de "prepare-se" e depois o cronômetro. A resposta é **revelada sozinha** quando o tempo acaba ou quando todos respondem.
6. Avance com **Mostrar ranking → Próxima pergunta**. No telão, a **barra de espaço** faz o próximo passo e **P** pausa.
7. Na última pergunta aparece **Ver pódio 🏆**: pódio animado no telão e resultado individual no celular de cada um.

> Os controles do telão aparecem quando o administrador fez login **no mesmo navegador**. Mova o mouse para mostrá-los.

**Modo 🏃 No seu ritmo**
1. Crie a sessão no modo **No seu ritmo** e compartilhe o link/PIN (ex.: no grupo de WhatsApp da loja).
2. Clique em **▶ Abrir sala** (ou, se configurou o horário de validade, a sala abre sozinha). Cada pessoa responde sozinha.
   - Com **Usar cronômetro em cada pergunta** marcado, vale o tempo de cada pergunta e os pontos dependem da rapidez.
   - Desmarcado, não há limite de tempo: cada acerto vale 1.000 pontos + bônus de sequência, e o tempo só desempata.
3. O telão mostra o ranking ao vivo e quantos já concluíram.
4. Clique em **Encerrar sala e mostrar pódio** para fechar e exibir o pódio final (com horário de encerramento, isso acontece sozinho).

---

## 5. Regras do jogo

**Pontuação por pergunta**
- Acerto: **até 1.000 pontos**, caindo até 500 conforme o tempo passa (responder rápido vale mais).
- **Bônus de sequência:** +100 a cada acerto seguido a partir do 2º (máximo +500).
- Erro ou tempo esgotado: 0 ponto e a sequência zera.
- Desempate: quem respondeu corretamente em menos tempo total.

**Ranking das lojas:** média de pontos por participante da loja/setor.

**Medalhas**
| | Medalha | Como ganhar |
|---|---|---|
| 🏆 | Gabaritou | Acertou todas |
| 🎯 | Precisão | 80% ou mais de acertos |
| 🔥 | Em chamas | 5 acertos seguidos |
| 🚀 | Imparável | 10 acertos seguidos |
| ⚡ | Mão rápida | 5 acertos em menos de 5 s |
| ⏱️ | Relâmpago | Foi o mais rápido a acertar alguma pergunta |
| 🦺 | Guardião da Segurança | Acertou todas de Segurança do Trabalho |
| 🤝 | Defensor do Respeito | Acertou todas de Prevenção ao Assédio |
| ✅ | Participação completa | Respondeu todas as perguntas |

---

## 6. Relatórios

Em **📊 Relatórios** ficam todas as sessões (histórico dos encontros), com:
- participantes, % de acertos e pontuação média;
- acertos por tema e **pontos de atenção** (perguntas com menos de 70% de acertos e a resposta errada mais marcada), úteis para planejar DDS e treinamentos;
- desempenho de cada pergunta, classificação geral e ranking das lojas;
- **⬇ Exportar Excel** com as abas Classificação, Lojas, Perguntas e Respostas (todas as respostas individuais).

---

## 7. Dúvidas comuns

| Problema | Solução |
|---|---|
| A tela mostra "Falta configurar o Supabase" | Preencha `config.js` e envie de novo ao GitHub. |
| "Senha de administrador inválida" | Senha inicial: `cipa2026`. Se trocou e esqueceu, rode no SQL Editor: `update app_settings set admin_hash = extensions.crypt('NovaSenha', extensions.gen_salt('bf'));` |
| Participante fechou o navegador | É só abrir o link de novo no mesmo celular: ele volta para o jogo com a pontuação. |
| Nome repetido | O sistema não aceita o mesmo nome na mesma loja. Peça para incluir o sobrenome. |
| Alguém entrou com nome impróprio | No painel da sessão, clique em **✕** ao lado do nome para remover. |
| A tela não atualiza sozinha | As telas também se atualizam a cada 3–4 s, mesmo se o tempo real falhar. Confira a internet. |

**Capacidade:** o plano gratuito do Supabase atende com folga os ~50 participantes simultâneos previstos.

---

## Estrutura

```
cipa-em-jogo/            (tudo na raiz, sem subpastas)
├── index.html  player.js   → participante (celular)
├── telao.html  telao.js    → telão / projetor
├── admin.html  admin.js    → painel do administrador
├── style.css  telao.css  admin.css
├── common.js               → funções compartilhadas
├── config.js               → URL e chave do Supabase
└── schema.sql              → banco, regras de pontuação e as 23 perguntas
```
