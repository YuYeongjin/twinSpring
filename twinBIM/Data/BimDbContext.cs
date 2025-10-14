using Microsoft.EntityFrameworkCore;
using BimProcessorApi.Models;

namespace BimProcessorApi.Data
{
    public class BimDbContext : DbContext
    {
        public DbSet<Project> Projects { get; set; }
        public DbSet<Element> Elements { get; set; }

        public BimDbContext(DbContextOptions<BimDbContext> options) : base(options)
        {
        }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            modelBuilder.Entity<Element>()
                .HasOne(e => e.Project)
                .WithMany(p => p.Elements)
                .HasForeignKey(e => e.ProjectId);
        }
    }
}