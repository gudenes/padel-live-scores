import { describe, it, expect } from 'vitest'
import { clusterArticles } from '../feed-scoring'

describe('clusterArticles', () => {
  it('groups articles with overlapping title tokens (>= 50% Jaccard)', () => {
    const articles = [
      { id: 'a', title: 'Galán y Chingotto a la final del Buenos Aires P1' },
      { id: 'b', title: 'Galán Chingotto llegan a la final en Buenos Aires' },
      { id: 'c', title: 'Tapia y Coello caen en semifinales' },
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].primary.id).toBe('a')
    expect(clusters[0].siblings).toEqual([articles[1]])
    expect(clusters[1].primary.id).toBe('c')
    expect(clusters[1].siblings).toEqual([])
  })

  it('returns each article as its own cluster when no overlap', () => {
    const articles = [
      { id: 'a', title: 'Premier Padel Madrid champions' },
      { id: 'b', title: 'FIP rankings updated' },
      { id: 'c', title: 'Bullpadel releases new racket' },
    ]
    const clusters = clusterArticles(articles)
    expect(clusters).toHaveLength(3)
    clusters.forEach(c => expect(c.siblings).toEqual([]))
  })

  it('returns empty array for empty input', () => {
    expect(clusterArticles([])).toEqual([])
  })

  it('first article in input order wins as primary', () => {
    const articles = [
      { id: 'newer', title: 'Galán Chingotto Buenos Aires final' },
      { id: 'older', title: 'Galán y Chingotto a la final Buenos Aires' },
    ]
    const clusters = clusterArticles(articles)
    expect(clusters[0].primary.id).toBe('newer')
    expect(clusters[0].siblings.map(s => s.id)).toEqual(['older'])
  })
})
