-- Palavrinhas da Manu: rode este arquivo uma vez no SQL Editor do Supabase.
-- Cria a tabela de palavras, o bucket de imagens e as regras de acesso.
-- Só usuários logados (que você cadastrar) podem ver ou mexer em qualquer coisa.

create table if not exists public.words (
  id          bigint generated always as identity primary key,
  name        text not null check (char_length(name) between 1 and 60),
  caption     text not null default '' check (char_length(caption) <= 280),
  category    text not null default 'outros'
              check (category in ('familia', 'animais', 'comidas', 'outros')),
  learned_on  date not null default current_date,
  image_path  text,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists words_learned_on on public.words (learned_on desc, id desc);

alter table public.words enable row level security;

drop policy if exists "familia pode ler" on public.words;
drop policy if exists "familia pode criar" on public.words;
drop policy if exists "familia pode editar" on public.words;
drop policy if exists "familia pode apagar" on public.words;

create policy "familia pode ler"    on public.words for select to authenticated using (true);
create policy "familia pode criar"  on public.words for insert to authenticated with check (true);
create policy "familia pode editar" on public.words for update to authenticated using (true) with check (true);
create policy "familia pode apagar" on public.words for delete to authenticated using (true);

-- Bucket privado: as imagens só abrem com link assinado, gerado para quem está logado.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imagens', 'imagens', false, 5242880, array['image/webp', 'image/png', 'image/jpeg', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "familia ve imagens" on storage.objects;
drop policy if exists "familia envia imagens" on storage.objects;
drop policy if exists "familia troca imagens" on storage.objects;
drop policy if exists "familia apaga imagens" on storage.objects;

create policy "familia ve imagens"    on storage.objects for select to authenticated using (bucket_id = 'imagens');
create policy "familia envia imagens" on storage.objects for insert to authenticated with check (bucket_id = 'imagens');
create policy "familia troca imagens" on storage.objects for update to authenticated using (bucket_id = 'imagens');
create policy "familia apaga imagens" on storage.objects for delete to authenticated using (bucket_id = 'imagens');
