import oracledb
import os
from dotenv import load_dotenv

load_dotenv()

conn = oracledb.connect(
    user=os.getenv('DB_USER'),
    password=os.getenv('DB_PASSWORD'),
    dsn=os.getenv('DB_DSN')
)

cursor = conn.cursor()
cursor.execute("""
    SELECT constraint_name, table_name, search_condition 
    FROM user_constraints 
    WHERE constraint_name = 'SYS_C0010388'
""")

result = cursor.fetchone()
if result:
    print(f"Constraint: {result[0]}")
    print(f"Table: {result[1]}")
    print(f"Condition: {result[2]}")
else:
    print("Constraint not found")

cursor.close()
conn.close()
