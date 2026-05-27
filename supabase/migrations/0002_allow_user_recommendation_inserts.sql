create policy "Users can insert own recommendations"
  on public.daily_recommendations for insert
  with check (auth.uid() = user_id);
