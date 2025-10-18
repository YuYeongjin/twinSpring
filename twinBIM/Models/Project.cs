using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using System.Collections.Generic;

namespace BimProcessorApi.Models
{
    [Table("bim_project")]
    public class Project
    {
        [Key]
        [Column("project_id")]
        public string? ProjectId { get; set; }

        [Column("project_name")]
        public string? ProjectName { get; set; }

        [Column("structure_type")]
        public string? StructureType { get; set; }

        [Column("span_count")]
        public string? SpanCount { get; set; }

        public ICollection<Element>? Elements { get; set; }
    }
}