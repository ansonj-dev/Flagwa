"""Track worker liveness independently of progress."""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("analysis_jobs", sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_analysis_jobs_heartbeat_at", "analysis_jobs", ["heartbeat_at"])


def downgrade():
    op.drop_index("ix_analysis_jobs_heartbeat_at", table_name="analysis_jobs")
    op.drop_column("analysis_jobs", "heartbeat_at")