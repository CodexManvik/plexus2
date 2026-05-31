# Oracle 26ai Native Vector Index Tuning Advisory

This advisory document provides deployment guidelines and tuning parameters for configuring Oracle 26ai native vector storage and indexing for the Plexus Contract Intelligence Platform.

## 1. Oracle Instance Memory Configuration (SGA/PGA)

Vector distance operations and index creation are highly memory-intensive. To ensure low-latency cosine calculations and prevent Out-Of-Memory (OOM) situations during HNSW index construction, configure the Oracle Database Instance with the following memory thresholds:

### System Global Area (SGA)
Set `SGA_TARGET` sufficiently large to cache vector metadata and table records.
```sql
ALTER SYSTEM SET sga_target = 8G SCOPE = SPFILE;
```

### Program Global Area (PGA)
PGA handles the vector index construction (HNSW graphs) and vector distance sort buffers. Inadequate PGA allocations will force sorting to use `TEMP` tablespace, causing substantial performance degradation.
```sql
ALTER SYSTEM SET pga_aggregate_target = 4G SCOPE = SPFILE;
ALTER SYSTEM SET pga_aggregate_limit = 8G SCOPE = SPFILE;
```

---

## 2. Vector Indexing Strategies

Oracle 26ai supports native Vector Indexing. For high-dimensional embeddings (e.g., Cohere Embed v3 at 1024 or 1536 dimensions), an **HNSW (Hierarchical Navigable Small World)** index is recommended for fast approximate nearest neighbor (ANN) searches.

### HNSW Index Creation Syntax
Execute the following DDL to construct the HNSW index on the `published_embeddings` table:

```sql
CREATE VECTOR INDEX idx_published_embeddings_hnsw
ON published_embeddings (embedding_vector)
ORGANIZATION INMEMORY NEIGHBOR GRAPHS
WITH TARGET ACCURACY 95
PARAMETERS (
  TYPE HNSW,
  NEIGHBORS 32,
  EFCONSTRUCTION 100
);
```

### Parameter Explanations:
1. **NEIGHBORS (M):** Specifies the maximum number of bi-directional connection links per node in the HNSW graph. Higher values (e.g., 32 or 48) improve search recall for high-dimensional vectors at the expense of memory footprint and construction time.
2. **EFCONSTRUCTION:** Controls the size of the dynamic candidate list evaluated during graph construction. Larger values (e.g., 100 or 150) result in a higher-quality graph structure but increase indexing latency.
3. **TARGET ACCURACY:** Defines the desired recall percentage (e.g., 95%). Oracle will automatically adjust search parameters to hit this target.

---

## 3. Query Execution Optimization

Ensure that standard SQL statements utilize the native `VECTOR_DISTANCE` function mapped directly to the HNSW index:

```sql
SELECT pub_param_id, contract_id,
       VECTOR_DISTANCE(embedding_vector, TO_VECTOR(:query_vec), COSINE) AS distance
FROM published_embeddings
ORDER BY distance ASC
FETCH FIRST :limit ROWS ONLY;
```

### Best Practices:
* **Index Matching:** Verify execution plans (`EXPLAIN PLAN`) to guarantee the optimizer performs an index range scan/ANN search on `idx_published_embeddings_hnsw` rather than a full table scan.
* **Vector Normalization:** Cohere Embed v3 vectors are normalized. Utilizing `COSINE` distance maps optimally to HNSW indexes.
